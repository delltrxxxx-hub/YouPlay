using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace YouPlay
{
    /// <summary>Hidden helpers that are never shown: YouTube Music (search, pages, playback), soundcloud.com
    /// (search, likes, playlists) and a small audio page for files and the SoundCloud widget (with the equalizer).</summary>
    class Engine
    {
        public Window Host;
        public WebView2 Yt, Sc, Pl;
        public CoreWebView2Environment Env;
        public bool Ready, Adblock = true;
        public Dictionary<string, object> Account = new Dictionary<string, object>();
        public event Action<Dictionary<string, object>> State, PlayerEvent;
        public event Action<string> Ended;
        public event Action ReadyChanged;
        readonly List<string> queue = new List<string>();
        readonly Dictionary<string, TaskCompletionSource<Dictionary<string, object>>> waiting = new Dictionary<string, TaskCompletionSource<Dictionary<string, object>>>();
        readonly Queue<string[]> scJobs = new Queue<string[]>(); string scBusy;
        readonly DispatcherTimer scTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(40) };
        public readonly List<string> LocalFiles = new List<string>();
        int seq;

        static string ReadText(string p) { try { return File.ReadAllText(p, Encoding.UTF8); } catch { return ""; } }
        static string DebugArgs() { var p = Environment.GetEnvironmentVariable("YOUPLAY_DEBUG_PORT"); return string.IsNullOrEmpty(p) ? "" : " --remote-debugging-port=" + p; }
        static bool IsGoogle(string url) { try { var h = new Uri(url).Host.ToLowerInvariant(); return Regex.IsMatch(h, @"(^|\.)(youtube\.com|google\.com|google\.[a-z.]+|gstatic\.com|googleusercontent\.com)$"); } catch { return false; } }
        public static bool IsSoundCloud(string url) { try { var h = new Uri(url).Host.ToLowerInvariant(); return Regex.IsMatch(h, @"(^|\.)(soundcloud\.com|sndcdn\.com)$") || url.StartsWith("about:"); } catch { return false; } }

        public async Task Init()
        {
            Host = new Window { Title = "YouPlay engine", Left = -12000, Top = -12000, Width = 1200, Height = 900, WindowStyle = WindowStyle.ToolWindow, ShowInTaskbar = false, ShowActivated = false, ResizeMode = ResizeMode.NoResize };
            var g = new Grid();
            Yt = new WebView2(); Sc = new WebView2(); Pl = new WebView2();
            g.Children.Add(Sc); g.Children.Add(Pl); g.Children.Add(Yt);
            Host.Content = g;
            Host.Show();
            var opts = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required --disable-features=CalculateNativeWinOcclusion --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows" + DebugArgs());
            Env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.Data, "WebView2"), opts);
            await Yt.EnsureCoreWebView2Async(Env);
            await Sc.EnsureCoreWebView2Async(Env);
            await Pl.EnsureCoreWebView2Async(Env);

            // YouTube Music
            var y = Yt.CoreWebView2;
            y.Settings.AreDefaultScriptDialogsEnabled = false;
            string eng = ReadText(Path.Combine(Program.Dir, "engine", "shield.js")) + "\n" + ReadText(Path.Combine(Program.Dir, "engine", "engine.js")) + "\n" + ReadText(Path.Combine(Program.Dir, "engine", "eq.js"));
            await y.AddScriptToExecuteOnDocumentCreatedAsync(KeepAwake + "\n" + eng);
            foreach (var f in new[] { "*doubleclick.net/*", "*googlesyndication.com/*", "*googleadservices.com/*", "*youtube.com/pagead/*", "*youtube.com/api/stats/ads*", "*youtube.com/ptracking*", "*youtube.com/get_midroll_*", "*imasdk.googleapis.com/*" })
                y.AddWebResourceRequestedFilter(f, CoreWebView2WebResourceContext.All);
            y.WebResourceRequested += (s, e) => { if (Adblock) e.Response = Env.CreateWebResourceResponse(null, 403, "Blocked", ""); };
            y.WebMessageReceived += (s, e) => { try { OnYt(e.TryGetWebMessageAsString()); } catch { } };
            y.NewWindowRequested += (s, e) => { e.Handled = true; };
            y.NavigationStarting += (s, e) => { if (!IsGoogle(e.Uri)) e.Cancel = true; };
            y.NavigationCompleted += (s, e) => { var src = y.Source ?? ""; if (Regex.IsMatch(src, @"^https://(www\.)?youtube\.com/?(\?|$|feed)")) y.Navigate("https://music.youtube.com/"); };
            y.Navigate("https://music.youtube.com/");

            // soundcloud.com helper
            var c = Sc.CoreWebView2;
            c.IsMuted = true;
            c.Settings.AreDefaultScriptDialogsEnabled = false;
            await c.AddScriptToExecuteOnDocumentCreatedAsync(ReadText(Path.Combine(Program.Dir, "engine", "sc-bridge.js")) + "\n" + ReadText(Path.Combine(Program.Dir, "engine", "sc-main.js")) + "\n" + ReadText(Path.Combine(Program.Dir, "engine", "sc-page.js")));
            c.WebMessageReceived += (s, e) => { try { OnSc(e.TryGetWebMessageAsString()); } catch { } };
            c.NewWindowRequested += (s, e) => { e.Handled = true; };
            c.NavigationStarting += (s, e) => { if (!IsSoundCloud(e.Uri)) e.Cancel = true; };
            scTimer.Tick += (s, e) => { scTimer.Stop(); if (scBusy != null) { Reply(scBusy, J.Make("error", "timeout")); scBusy = null; ScNext(); } };

            // audio page: files and the SoundCloud widget, both through the equalizer where possible
            var p = Pl.CoreWebView2;
            p.Settings.AreDefaultScriptDialogsEnabled = false;
            p.AddWebResourceRequestedFilter("https://youplay.local/*", CoreWebView2WebResourceContext.All);
            p.WebResourceRequested += OnLocal;
            p.WebMessageReceived += (s, e) => { try { var d = J.Parse(e.TryGetWebMessageAsString()); if (PlayerEvent != null) PlayerEvent(d); } catch { } };
            p.Navigate("https://youplay.local/player.html");
        }

        public void Block(CoreWebView2 w)
        {
            foreach (var f in new[] { "*doubleclick.net/*", "*googlesyndication.com/*", "*googleadservices.com/*", "*youtube.com/pagead/*", "*youtube.com/api/stats/ads*", "*youtube.com/ptracking*", "*youtube.com/get_midroll_*", "*imasdk.googleapis.com/*" })
                w.AddWebResourceRequestedFilter(f, CoreWebView2WebResourceContext.All);
            w.WebResourceRequested += (s, e) => { if (!e.Request.Uri.StartsWith("https://youplay.local/")) e.Response = Env.CreateWebResourceResponse(null, 403, "Blocked", ""); };
        }
        const string KeepAwake = "try{Object.defineProperty(Document.prototype,'hidden',{get:function(){return false},configurable:true});Object.defineProperty(Document.prototype,'visibilityState',{get:function(){return 'visible'},configurable:true});document.addEventListener('visibilitychange',function(e){e.stopImmediatePropagation()},true);}catch(e){}";

        // ── YouTube Music engine ──
        void OnYt(string raw)
        {
            var m = J.Parse(raw);
            var t = J.S(m, "t");
            if (t == "eng") { Reply(J.S(m, "id"), J.O(m, "data")); return; }
            if (t == "state") { if (State != null) State(m); return; }
            if (t == "ended") { if (Ended != null) Ended(J.S(m, "videoId")); return; }
            if (t == "engine-ready")
            {
                Ready = true; Account = J.O(m, "account") ?? new Dictionary<string, object>();
                foreach (var q in queue) Exec(Yt, "window.__ypEng && window.__ypEng(" + q + ")");
                queue.Clear();
                if (ReadyChanged != null) ReadyChanged();
            }
        }
        static void Exec(WebView2 w, string js) { try { if (w.CoreWebView2 != null) w.CoreWebView2.ExecuteScriptAsync(js); } catch { } }
        void Reply(string id, Dictionary<string, object> data)
        {
            TaskCompletionSource<Dictionary<string, object>> tcs;
            if (id != null && waiting.TryGetValue(id, out tcs)) { waiting.Remove(id); tcs.TrySetResult(data ?? new Dictionary<string, object>()); }
        }
        TaskCompletionSource<Dictionary<string, object>> Wait(string id, int seconds)
        {
            var tcs = new TaskCompletionSource<Dictionary<string, object>>();
            waiting[id] = tcs;
            var disp = Dispatcher.CurrentDispatcher;
            Task.Delay(seconds * 1000).ContinueWith(_ => disp.BeginInvoke((Action)(() => Reply(id, J.Make("error", "timeout")))));
            return tcs;
        }
        /// <summary>Ask the YouTube Music engine: home, search, browse, likes, account, playlists, plAdd, plCreate, lyrics, play, control.</summary>
        public Task<Dictionary<string, object>> Eng(string cmd, params object[] kv)
        {
            var d = J.Make(kv); d["cmd"] = cmd; d["t"] = "eng"; var id = "n" + (++seq); d["id"] = id;
            var tcs = Wait(id, 60);
            var raw = J.Str(d);
            if (Ready) Exec(Yt, "window.__ypEng && window.__ypEng(" + raw + ")"); else queue.Add(raw);
            return tcs.Task;
        }
        public void Control(string op, params object[] kv)
        {
            var all = new List<object> { "op", op }; all.AddRange(kv);
            Eng("control", all.ToArray());
        }
        public void Reload() { Ready = false; try { Yt.CoreWebView2.Navigate("https://music.youtube.com/"); } catch { } }

        // ── soundcloud.com pages ──
        void OnSc(string raw)
        {
            var m = Regex.Match(raw, "^scdata:(.*)$", RegexOptions.Singleline);
            if (!m.Success) return;
            var d = J.Parse(m.Groups[1].Value);
            var id = J.S(d, "id");
            Reply(id, d);
            if (id == scBusy) { scTimer.Stop(); scBusy = null; ScNext(); }
        }
        /// <summary>op = search | likes | status | sets | set | like | unlike | addto | create.</summary>
        public Task<Dictionary<string, object>> Soundcloud(string op, string arg)
        {
            var id = "s" + (++seq);
            var tcs = Wait(id, 70);
            scJobs.Enqueue(new[] { op, id, arg ?? "" });
            if (scBusy == null) ScNext();
            return tcs.Task;
        }
        void ScNext()
        {
            if (scBusy != null || scJobs.Count == 0) return;
            var j = scJobs.Dequeue(); string op = j[0], id = j[1], arg = j[2], url = null;
            bool scUrl = IsSoundCloud(arg) && arg.StartsWith("https://");
            if (op == "search") url = "https://soundcloud.com/search/sounds?q=" + Uri.EscapeDataString(arg) + "&yp=" + id + "#yp=search:" + id;
            else if (op == "likes") url = "https://soundcloud.com/you/likes?yp=" + id + "#yp=likes:" + id;
            else if (op == "status") url = "https://soundcloud.com/you/library?yp=" + id + "#yp=status:" + id;
            else if (op == "sets") url = "https://soundcloud.com/you/sets?yp=" + id + "#yp=sets:" + id;
            else if (scUrl && (op == "set" || op == "like" || op == "unlike")) url = arg.Split('#')[0] + (arg.Contains("?") ? "&" : "?") + "yp=" + id + "#yp=" + op + ":" + id;
            else if (scUrl && (op == "addto" || op == "create"))
            {
                int k = arg.IndexOf("#name="); string name = k >= 0 ? arg.Substring(k + 6) : "", track = k >= 0 ? arg.Substring(0, k) : arg;
                url = track + (track.Contains("?") ? "&" : "?") + "yp=" + id + "#yp=" + op + ":" + id + ":" + name;
            }
            if (url == null) { Reply(id, J.Make("error", "bad")); ScNext(); return; }
            scBusy = id; scTimer.Stop(); scTimer.Start();
            try { Sc.CoreWebView2.Navigate(url); } catch { }
        }

        // ── audio page ──
        public void PlayLocal(string id) { Exec(Pl, "window.playLocal && playLocal('https://youplay.local/media/" + id + "')"); }
        public void ScLoad(string url) { Exec(Pl, "window.scLoad && scLoad(" + J.Str(url) + ")"); }
        public void PlCmd(string src, string m, double v) { Exec(Pl, "window.cmd && cmd(" + J.Str(src) + "," + J.Str(m) + "," + v.ToString(System.Globalization.CultureInfo.InvariantCulture) + ")"); }
        public void StopPage() { Exec(Pl, "window.stopAll && stopAll()"); }
        public void Volume(double v)
        {
            var s = v.ToString(System.Globalization.CultureInfo.InvariantCulture);
            Exec(Pl, "window.setVol && setVol(" + s + ")");
            Control("volume", "value", v);
        }
        public void Equalizer(bool on, double[] gains)
        {
            var arr = new List<string>(); foreach (var gv in gains) arr.Add(gv.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture));
            var js = "window.__ypEq && window.__ypEq(" + (on ? "true" : "false") + ",[" + string.Join(",", arr) + "])";
            Exec(Pl, js); Exec(Yt, js);
        }

        const string PlayerHtml = @"<!doctype html><html><head><meta charset='utf-8'><script src='/eq.js'></script></head><body style='margin:0;background:#000'>
<audio id='a' preload='auto'></audio><iframe id='f' allow='autoplay' style='width:400px;height:160px;border:0'></iframe>
<script>
var a=document.getElementById('a'),f=document.getElementById('f'),O='https://w.soundcloud.com',ready=false,vol=1,lastT=0;
function send(o){try{chrome.webview.postMessage(JSON.stringify(o));}catch(e){}}
function post(m,v){if(ready&&f.contentWindow)f.contentWindow.postMessage(JSON.stringify(v===undefined?{method:m}:{method:m,value:v}),O);}
window.playLocal=function(u){post('pause');ready=false;f.src='about:blank';a.src=u;a.volume=vol;if(window.__ypEqState&&window.__ypEqState.on)window.__ypEqSetup(a);a.play().catch(function(e){send({src:'local',ev:'error'});});};
window.scLoad=function(u){a.pause();ready=false;f.src=O+'/player/?url='+encodeURIComponent(u)+'&auto_play=true&visual=false&show_artwork=false&show_comments=false&buying=false&sharing=false&download=false';};
window.cmd=function(src,m,v){if(src==='local'){if(m==='play')a.play();else if(m==='pause')a.pause();else if(m==='seek')a.currentTime=v;}else{if(m==='seek')post('seekTo',v*1000);else post(m);}};
window.setVol=function(v){vol=v;a.volume=v;post('setVolume',Math.round(v*100));};
window.stopAll=function(){a.pause();post('pause');};
a.addEventListener('play',function(){send({src:'local',ev:'play'});});
a.addEventListener('pause',function(){send({src:'local',ev:'pause'});});
a.addEventListener('ended',function(){send({src:'local',ev:'finish'});});
a.addEventListener('error',function(){if(a.src&&a.src.indexOf('/media/')>0)send({src:'local',ev:'error'});});
a.addEventListener('timeupdate',function(){send({src:'local',ev:'progress',pos:a.currentTime,dur:isFinite(a.duration)?a.duration:0});});
addEventListener('message',function(e){if(e.origin!==O)return;var m;try{m=typeof e.data==='string'?JSON.parse(e.data):e.data;}catch(x){return;}if(!m)return;
if(m.method==='ready'){ready=true;['play','pause','finish','playProgress','error'].forEach(function(ev){f.contentWindow.postMessage(JSON.stringify({method:'addEventListener',value:ev}),O);});post('setVolume',Math.round(vol*100));post('play');post('getCurrentSound');}
else if(m.method==='playProgress'&&m.value)send({src:'sc',ev:'progress',pos:m.value.currentPosition/1000});
else if(m.method==='getCurrentSound'&&m.value)send({src:'sc',ev:'sound',dur:(m.value.duration||0)/1000,art:m.value.artwork_url||''});
else if(m.method)send({src:'sc',ev:m.method});});
</script></body></html>";

        void OnLocal(object sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            try
            {
                var path = Uri.UnescapeDataString(new Uri(e.Request.Uri).AbsolutePath);
                if (path == "/player.html") { e.Response = Env.CreateWebResourceResponse(new MemoryStream(Encoding.UTF8.GetBytes(PlayerHtml)), 200, "OK", "Content-Type: text/html; charset=utf-8"); return; }
                if (path == "/eq.js") { e.Response = Env.CreateWebResourceResponse(new MemoryStream(Encoding.UTF8.GetBytes(ReadText(Path.Combine(Program.Dir, "engine", "eq.js")))), 200, "OK", "Content-Type: application/javascript; charset=utf-8"); return; }
                if (path.StartsWith("/media/"))
                {
                    int idx; string file = null;
                    lock (LocalFiles) { if (int.TryParse(path.Substring(7), out idx) && idx >= 0 && idx < LocalFiles.Count) file = LocalFiles[idx]; }
                    if (file == null) { e.Response = Env.CreateWebResourceResponse(null, 404, "Not Found", ""); return; }
                    var fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                    long size = fs.Length;
                    string range = e.Request.Headers.Contains("Range") ? e.Request.Headers.GetHeader("Range") : null;
                    string mime = Mime(file);
                    var rm = range == null ? null : Regex.Match(range, @"bytes=(\d*)-(\d*)");
                    if (rm != null && rm.Success)
                    {
                        long start = rm.Groups[1].Value.Length > 0 ? long.Parse(rm.Groups[1].Value) : 0;
                        long end = rm.Groups[2].Value.Length > 0 ? Math.Min(size - 1, long.Parse(rm.Groups[2].Value)) : size - 1;
                        fs.Position = start;
                        e.Response = Env.CreateWebResourceResponse(new SubStream(fs, end - start + 1), 206, "Partial Content",
                            "Content-Type: " + mime + "\r\nAccept-Ranges: bytes\r\nContent-Range: bytes " + start + "-" + end + "/" + size + "\r\nContent-Length: " + (end - start + 1));
                    }
                    else e.Response = Env.CreateWebResourceResponse(fs, 200, "OK", "Content-Type: " + mime + "\r\nAccept-Ranges: bytes\r\nContent-Length: " + size);
                    return;
                }
                e.Response = Env.CreateWebResourceResponse(null, 404, "Not Found", "");
            }
            catch { e.Response = Env.CreateWebResourceResponse(null, 500, "Error", ""); }
        }
        static string Mime(string f)
        {
            switch (Path.GetExtension(f).ToLowerInvariant())
            {
                case ".mp3": return "audio/mpeg";
                case ".m4a": case ".aac": return "audio/mp4";
                case ".flac": return "audio/flac";
                case ".ogg": case ".opus": return "audio/ogg";
                case ".wav": return "audio/wav";
                default: return "application/octet-stream";
            }
        }

        // ── Моя музыка ──
        public static string MusicFolder()
        {
            var p = Store.Get("musicFolder", "");
            if (p.Length > 0 && Directory.Exists(p)) return p;
            return Environment.GetFolderPath(Environment.SpecialFolder.MyMusic);
        }
        public List<Track> ScanLocal()
        {
            var list = new List<Track>();
            lock (LocalFiles)
            {
                LocalFiles.Clear();
                try
                {
                    foreach (var f in Directory.EnumerateFiles(MusicFolder(), "*.*", SearchOption.AllDirectories))
                    {
                        var ext = Path.GetExtension(f).ToLowerInvariant();
                        if (ext != ".mp3" && ext != ".m4a" && ext != ".aac" && ext != ".flac" && ext != ".ogg" && ext != ".opus" && ext != ".wav") continue;
                        if (LocalFiles.Count >= 8000) break;
                        string title, artist, album; Tags.Read(f, out title, out artist, out album);
                        var t = new Track { Src = "local", Id = LocalFiles.Count.ToString(), Title = title, Artist = artist };
                        LocalFiles.Add(f); list.Add(t);
                    }
                }
                catch { }
            }
            list.Sort((a, b) => string.Compare(a.Artist + a.Title, b.Artist + b.Title, StringComparison.CurrentCultureIgnoreCase));
            return list;
        }

        // ── sign-in ──
        public async Task<bool> Login(Window owner, string service)
        {
            var w = new Window { Title = service == "sc" ? "Вход в SoundCloud — YouPlay" : "Вход в аккаунт Google — YouPlay", Width = 540, Height = 780, Owner = owner, WindowStartupLocation = WindowStartupLocation.CenterOwner, Background = Ui.Br(Ui.BG) };
            var wv = new WebView2(); w.Content = wv;
            bool ok = false;
            w.Show();
            try { await wv.EnsureCoreWebView2Async(Env); } catch { w.Close(); return false; }
            var done = new TaskCompletionSource<bool>();
            w.Closed += (s, e) => done.TrySetResult(ok);
            wv.CoreWebView2.NavigationCompleted += async (s, e) =>
            {
                try
                {
                    var src = wv.CoreWebView2.Source ?? "";
                    if (service != "sc") { if (src.StartsWith("https://music.youtube.com")) { ok = true; w.Close(); } return; }
                    if (!Regex.IsMatch(src, "^https://(www\\.)?soundcloud\\.com/") || src.Contains("/signin")) return;
                    var cookies = await wv.CoreWebView2.CookieManager.GetCookiesAsync("https://soundcloud.com");
                    foreach (var ck in cookies) if (ck.Name == "oauth_token" && ck.Value.Length > 0) { ok = true; w.Close(); return; }
                }
                catch { }
            };
            wv.CoreWebView2.Navigate(service == "sc" ? "https://soundcloud.com/signin" : "https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&continue=" + Uri.EscapeDataString("https://www.youtube.com/signin?action_handle_signin=true&app=desktop&next=https%3A%2F%2Fmusic.youtube.com%2F"));
            var r = await done.Task;
            if (r && service != "sc") Reload();
            return r;
        }
        public async Task ScLogout()
        {
            try
            {
                var cm = Yt.CoreWebView2.CookieManager;
                foreach (var h in new[] { "https://soundcloud.com", "https://secure.soundcloud.com", "https://api-auth.soundcloud.com", "https://api-v2.soundcloud.com" })
                { var list = await cm.GetCookiesAsync(h); foreach (var ck in list) cm.DeleteCookie(ck); }
            }
            catch { }
        }
    }
}
