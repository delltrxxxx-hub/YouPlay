// YouPlay 2 for Windows — a native window with YouPlay's own interface (files inside the app, shown at
// https://youplay.local/), a hidden YouTube Music window that plays music ("engine"), a hidden SoundCloud
// window for SoundCloud search/likes, files from the Music folder, sign-in windows and one-click updates.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("YouPlay")]
[assembly: AssemblyProduct("YouPlay")]
[assembly: AssemblyVersion("__VERSION__.0")]
[assembly: AssemblyFileVersion("__VERSION__.0")]

static class Program
{
    public const string Version = "__VERSION__";
    public const string Repo = "delltrxxxx-hub/YouPlay";
    // YOUPLAY_DATA_DIR lets a test copy run with its own profile, separate from the real one
    public static readonly string Data = string.IsNullOrEmpty(Environment.GetEnvironmentVariable("YOUPLAY_DATA_DIR"))
        ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "YouPlay")
        : Environment.GetEnvironmentVariable("YOUPLAY_DATA_DIR");
    public static readonly string Dir = AppDomain.CurrentDomain.BaseDirectory;

    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);

    [STAThread]
    static void Main(string[] args)
    {
        bool first;
        using (var mutex = new Mutex(true, "YouPlay.SingleInstance." + Data.GetHashCode().ToString("x"), out first))
        {
            if (!first)
            {
                foreach (var p in Process.GetProcessesByName("YouPlay"))
                    if (p.Id != Process.GetCurrentProcess().Id && p.MainWindowHandle != IntPtr.Zero) { ShowWindow(p.MainWindowHandle, 9); SetForegroundWindow(p.MainWindowHandle); }
                return;
            }
            Directory.CreateDirectory(Data);
            Updater.Enabled = Array.IndexOf(args, "--no-update") < 0;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainWindow());
        }
    }
}

class MainWindow : Form
{
    readonly WebView2 ui = new WebView2();    // YouPlay's own interface
    readonly WebView2 yt = new WebView2();    // hidden: YouTube Music engine
    readonly WebView2 sc = new WebView2();    // hidden: soundcloud.com for search and likes
    CoreWebView2Environment env;
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024 };
    bool engineReady; readonly List<string> engineQueue = new List<string>();
    bool adblock = true;
    readonly Queue<string[]> scJobs = new Queue<string[]>(); string scBusy;
    readonly System.Windows.Forms.Timer scTimer = new System.Windows.Forms.Timer();
    readonly List<string> localFiles = new List<string>();
    readonly string boundsFile = Path.Combine(Program.Data, "window.txt");
    readonly string folderFile = Path.Combine(Program.Data, "music-folder.txt");
    bool isFull; FormWindowState prevState; Rectangle prevBounds;

    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    public MainWindow()
    {
        Text = "YouPlay";
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        BackColor = Color.FromArgb(18, 13, 11);
        MinimumSize = new Size(420, 560);
        StartPosition = FormStartPosition.Manual;
        RestoreBounds_();
        foreach (var w in new[] { yt, sc }) { w.Dock = DockStyle.None; w.Location = new Point(0, 0); w.Size = new Size(1200, 900); w.DefaultBackgroundColor = BackColor; Controls.Add(w); }
        ui.Dock = DockStyle.Fill; ui.DefaultBackgroundColor = BackColor; Controls.Add(ui); ui.BringToFront();
        scTimer.Interval = 30000;
        scTimer.Tick += (s, e) => { scTimer.Stop(); if (scBusy != null) { PostUi(new Dictionary<string, object> { { "t", "scdata" }, { "data", new Dictionary<string, object> { { "id", scBusy }, { "error", "timeout" } } } }); scBusy = null; ScNext(); } };
        Load += async (s, e) => await Init();
        FormClosing += (s, e) => SaveBounds();
    }

    protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); SetCaption(Color.FromArgb(18, 13, 11)); }
    void SetCaption(Color c)
    {
        try
        {
            int dark = 1; DwmSetWindowAttribute(Handle, 20, ref dark, 4);
            int bgr = (c.B << 16) | (c.G << 8) | c.R;
            DwmSetWindowAttribute(Handle, 35, ref bgr, 4);
            int t = 0x00EAEEF4; DwmSetWindowAttribute(Handle, 36, ref t, 4);
            DwmSetWindowAttribute(Handle, 34, ref bgr, 4);
        }
        catch { }
    }

    async Task Init()
    {
        try
        {
            var opts = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required" + DebugArgs());
            env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.Data, "WebView2"), opts);
            await ui.EnsureCoreWebView2Async(env);
            await yt.EnsureCoreWebView2Async(env);
            await sc.EnsureCoreWebView2Async(env);
        }
        catch (Exception ex)
        {
            MessageBox.Show("Не удалось запустить WebView2: " + ex.Message + "\n\nУстановите «Microsoft Edge WebView2 Runtime» с сайта Microsoft.", "YouPlay");
            Close(); return;
        }
        // the interface: files inside the app
        var u = ui.CoreWebView2;
        u.Settings.AreDefaultContextMenusEnabled = false;
        u.Settings.IsStatusBarEnabled = false;
        u.Settings.IsZoomControlEnabled = false;
        u.Settings.AreBrowserAcceleratorKeysEnabled = false;
        u.Settings.IsPasswordAutosaveEnabled = false;
        u.AddWebResourceRequestedFilter("https://youplay.local/*", CoreWebView2WebResourceContext.All);
        u.WebResourceRequested += OnLocalRequest;
        u.WebMessageReceived += (s, e) => { try { OnUi(e.TryGetWebMessageAsString()); } catch { } };
        u.DocumentTitleChanged += (s, e) => { Text = string.IsNullOrEmpty(u.DocumentTitle) ? "YouPlay" : u.DocumentTitle; };
        u.NewWindowRequested += (s, e) => { e.Handled = true; OpenExternal(e.Uri); };
        u.NavigationStarting += (s, e) => { if (!e.Uri.StartsWith("https://youplay.local/")) { e.Cancel = true; OpenExternal(e.Uri); } };
        u.Navigate("https://youplay.local/index.html");

        // the engine: YouTube Music, never shown
        var y = yt.CoreWebView2;
        y.Settings.AreDefaultScriptDialogsEnabled = false;
        y.Settings.IsStatusBarEnabled = false;
        string shield = ReadText(Path.Combine(Program.Dir, "engine", "shield.js"));
        string engine = ReadText(Path.Combine(Program.Dir, "engine", "engine.js"));
        await y.AddScriptToExecuteOnDocumentCreatedAsync(shield + "\n" + engine);
        foreach (var f in new[] { "*doubleclick.net/*", "*googlesyndication.com/*", "*googleadservices.com/*", "*youtube.com/pagead/*", "*youtube.com/api/stats/ads*", "*youtube.com/ptracking*", "*youtube.com/get_midroll_*", "*imasdk.googleapis.com/*" })
            y.AddWebResourceRequestedFilter(f, CoreWebView2WebResourceContext.All);
        y.WebResourceRequested += (s, e) => { if (adblock) e.Response = env.CreateWebResourceResponse(null, 403, "Blocked", ""); };
        y.WebMessageReceived += (s, e) => { try { OnEngine(e.TryGetWebMessageAsString()); } catch { } };
        y.NewWindowRequested += (s, e) => { e.Handled = true; };
        y.NavigationStarting += (s, e) => { if (!IsGoogle(e.Uri)) e.Cancel = true; else if (e.IsRedirected == false && e.Uri.StartsWith("https://music.youtube.com") && !e.IsUserInitiated) { } };
        y.NavigationCompleted += (s, e) => { var src = y.Source ?? ""; if (Regex.IsMatch(src, @"^https://(www\.)?youtube\.com/?(\?|$|feed)")) y.Navigate("https://music.youtube.com/"); };
        y.Navigate("https://music.youtube.com/");

        // SoundCloud helper page
        var c = sc.CoreWebView2;
        c.IsMuted = true;
        c.Settings.AreDefaultScriptDialogsEnabled = false;
        string scScripts = ReadText(Path.Combine(Program.Dir, "engine", "sc-bridge.js")) + "\n" + ReadText(Path.Combine(Program.Dir, "engine", "sc-main.js")) + "\n" + ReadText(Path.Combine(Program.Dir, "engine", "sc-page.js"));
        await c.AddScriptToExecuteOnDocumentCreatedAsync(scScripts);
        c.WebMessageReceived += (s, e) => { try { OnSc(e.TryGetWebMessageAsString()); } catch { } };
        c.NewWindowRequested += (s, e) => { e.Handled = true; };
        c.NavigationStarting += (s, e) => { if (!IsSoundCloud(e.Uri)) e.Cancel = true; };

        if (Updater.Enabled) Task.Run(() => { Thread.Sleep(5000); try { Updater.Check(); } catch { Updater.State = "error"; } BeginInvoke((Action)PostUpdate); });
    }

    static string DebugArgs() { var p = Environment.GetEnvironmentVariable("YOUPLAY_DEBUG_PORT"); return string.IsNullOrEmpty(p) ? "" : " --remote-debugging-port=" + p; }
    static string ReadText(string p) { try { return File.ReadAllText(p, Encoding.UTF8); } catch { return ""; } }
    static bool IsGoogle(string url) { try { var h = new Uri(url).Host.ToLowerInvariant(); return Regex.IsMatch(h, @"(^|\.)(youtube\.com|google\.com|google\.[a-z.]+|gstatic\.com|googleusercontent\.com)$"); } catch { return false; } }
    static bool IsSoundCloud(string url) { try { var h = new Uri(url).Host.ToLowerInvariant(); return Regex.IsMatch(h, @"(^|\.)(soundcloud\.com|sndcdn\.com)$") || url.StartsWith("about:"); } catch { return false; } }
    static void OpenExternal(string url) { try { if (url.StartsWith("https://") || url.StartsWith("http://")) Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { } }

    void PostUi(object o) { try { if (ui.CoreWebView2 != null) ui.CoreWebView2.PostWebMessageAsString(json.Serialize(o)); } catch { } }
    void PostUiRaw(string s) { try { if (ui.CoreWebView2 != null) ui.CoreWebView2.PostWebMessageAsString(s); } catch { } }
    static string S(Dictionary<string, object> m, string k) { object v; return m.TryGetValue(k, out v) && v != null ? v.ToString() : ""; }

    // ── messages from the interface ──
    void OnUi(string raw)
    {
        var m = json.Deserialize<Dictionary<string, object>>(raw);
        string t = S(m, "t");
        if (t == "eng") { if (engineReady) yt.CoreWebView2.ExecuteScriptAsync("window.__ypEng && window.__ypEng(" + raw + ")"); else engineQueue.Add(raw); return; }
        if (t == "sc") { scJobs.Enqueue(new[] { S(m, "op"), S(m, "id"), S(m, "arg") }); if (scBusy == null) ScNext(); return; }
        if (t == "fetch") { Fetch(S(m, "id"), S(m, "url")); return; }
        if (t == "local") { var id = S(m, "id"); Task.Run(() => { var list = ScanLocal(); BeginInvoke((Action)(() => PostUi(new Dictionary<string, object> { { "t", "local" }, { "id", id }, { "tracks", list } }))); }); return; }
        if (t == "pick-folder") { PickFolder(); return; }
        if (t == "login") { if (S(m, "service") == "sc") ScLogin(); else GoogleLogin(); return; }
        if (t == "logout") { ScLogout(); return; }
        if (t == "adblock") { adblock = S(m, "value") == "True"; return; }
        if (t == "update")
        {
            var op = S(m, "op");
            if (op == "now") UpdateNow();
            else if (op == "check")
            {
                if (!Updater.Enabled) { Updater.State = "dev"; PostUpdate(); return; }
                Updater.State = "checking"; PostUpdate();
                Task.Run(() => { try { Updater.Check(); } catch { Updater.State = "error"; } BeginInvoke((Action)PostUpdate); });
            }
            else PostUpdate();
            return;
        }
        if (t == "window")
        {
            var op = S(m, "op");
            if (op == "fullscreen") ToggleFullscreen();
            else if (op == "caption") { try { var c = ColorTranslator.FromHtml(S(m, "color")); SetCaption(c); BackColor = c; } catch { } }
        }
    }

    // ── messages from the engine (forwarded to the interface) ──
    void OnEngine(string raw)
    {
        if (raw.Contains("\"t\":\"engine-ready\""))
        {
            engineReady = true;
            foreach (var q in engineQueue) yt.CoreWebView2.ExecuteScriptAsync("window.__ypEng && window.__ypEng(" + q + ")");
            engineQueue.Clear();
        }
        PostUiRaw(raw);
    }

    // ── SoundCloud helper page ──
    void OnSc(string raw)
    {
        var m = Regex.Match(raw, "^scdata:(.*)$", RegexOptions.Singleline);
        if (!m.Success) return;
        string data = m.Groups[1].Value;
        PostUiRaw("{\"t\":\"scdata\",\"data\":" + data + "}");
        var idm = Regex.Match(data, "\"id\"\\s*:\\s*\"([A-Za-z0-9_-]+)\"");
        if (idm.Success && idm.Groups[1].Value == scBusy) { scTimer.Stop(); scBusy = null; ScNext(); }
    }
    void ScNext()
    {
        if (scBusy != null || scJobs.Count == 0) return;
        var j = scJobs.Dequeue(); string op = j[0], id = j[1], arg = j[2], url;
        if (op == "search") url = "https://soundcloud.com/search/sounds?q=" + Uri.EscapeDataString(arg) + "&yp=" + id + "#yp=search:" + id;
        else if (op == "likes") url = "https://soundcloud.com/you/likes?yp=" + id + "#yp=likes:" + id;
        else if (op == "status") url = "https://soundcloud.com/you/library?yp=" + id + "#yp=status:" + id;
        else if (op == "sets") url = "https://soundcloud.com/you/sets?yp=" + id + "#yp=sets:" + id;
        else if (op == "set" && IsSoundCloud(arg) && arg.StartsWith("https://")) url = arg.Split('#')[0] + (arg.Contains("?") ? "&" : "?") + "yp=" + id + "#yp=set:" + id;
        else if ((op == "addto" || op == "create") && IsSoundCloud(arg) && arg.StartsWith("https://"))
        {
            int k = arg.IndexOf("#name=");
            string name = k >= 0 ? arg.Substring(k + 6) : "", track = k >= 0 ? arg.Substring(0, k) : arg;
            url = track + (track.Contains("?") ? "&" : "?") + "yp=" + id + "#yp=" + op + ":" + id + ":" + name;
        }
        else if ((op == "like" || op == "unlike") && IsSoundCloud(arg) && arg.StartsWith("https://")) url = arg.Split('#')[0] + (arg.Contains("?") ? "&" : "?") + "yp=" + id + "#yp=" + op + ":" + id;
        else { PostUi(new Dictionary<string, object> { { "t", "scdata" }, { "data", new Dictionary<string, object> { { "id", id }, { "error", "bad" } } } }); ScNext(); return; }
        scBusy = id; scTimer.Stop(); scTimer.Start();
        sc.CoreWebView2.Navigate(url);
    }

    // ── sign-in windows ──
    Form loginForm;
    async void GoogleLogin()
    {
        if (loginForm != null && !loginForm.IsDisposed) { loginForm.Activate(); return; }
        var f = new Form { Text = "Вход в аккаунт Google — YouPlay", Size = new Size(520, 760), StartPosition = FormStartPosition.CenterParent, Icon = Icon, BackColor = BackColor };
        var w = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = BackColor };
        f.Controls.Add(w); loginForm = f; bool ok = false;
        f.FormClosed += (s, e) => { if (ok) { engineReady = false; yt.CoreWebView2.Navigate("https://music.youtube.com/"); } PostUi(new Dictionary<string, object> { { "t", "login" }, { "service", "google" }, { "ok", ok } }); };
        f.Show(this);
        try { await w.EnsureCoreWebView2Async(env); } catch { f.Close(); return; }
        w.CoreWebView2.NavigationCompleted += (s, e) => { var src = w.CoreWebView2.Source ?? ""; if (src.StartsWith("https://music.youtube.com")) { ok = true; f.Close(); } };
        w.CoreWebView2.Navigate("https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&continue=" + Uri.EscapeDataString("https://www.youtube.com/signin?action_handle_signin=true&app=desktop&next=https%3A%2F%2Fmusic.youtube.com%2F"));
    }
    async void ScLogin()
    {
        if (loginForm != null && !loginForm.IsDisposed) { loginForm.Activate(); return; }
        var f = new Form { Text = "Вход в SoundCloud — YouPlay", Size = new Size(560, 780), StartPosition = FormStartPosition.CenterParent, Icon = Icon, BackColor = BackColor };
        var w = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = BackColor };
        f.Controls.Add(w); loginForm = f; bool ok = false;
        f.FormClosed += (s, e) => PostUi(new Dictionary<string, object> { { "t", "login" }, { "service", "sc" }, { "ok", ok } });
        f.Show(this);
        try { await w.EnsureCoreWebView2Async(env); } catch { f.Close(); return; }
        w.CoreWebView2.NavigationCompleted += async (s, e) =>
        {
            try
            {
                var src = w.CoreWebView2.Source ?? "";
                if (!Regex.IsMatch(src, "^https://(www\\.)?soundcloud\\.com/") || src.Contains("/signin")) return;
                var cookies = await w.CoreWebView2.CookieManager.GetCookiesAsync("https://soundcloud.com");
                foreach (var ck in cookies) if (ck.Name == "oauth_token" && ck.Value.Length > 0) { ok = true; f.Close(); return; }
            }
            catch { }
        };
        w.CoreWebView2.Navigate("https://soundcloud.com/signin");
    }
    async void ScLogout()
    {
        try
        {
            var cm = ui.CoreWebView2.CookieManager;
            foreach (var h in new[] { "https://soundcloud.com", "https://secure.soundcloud.com", "https://api-auth.soundcloud.com", "https://api-v2.soundcloud.com" })
            { var list = await cm.GetCookiesAsync(h); foreach (var ck in list) cm.DeleteCookie(ck); }
        }
        catch { }
    }

    // ── small HTTP helper (lyrics, SoundCloud links) ──
    void Fetch(string id, string url)
    {
        Task.Run(() =>
        {
            int status = 0; string body = "";
            try
            {
                if (!Regex.IsMatch(url, "^https://(lrclib\\.net|soundcloud\\.com|api\\.github\\.com)/")) throw new Exception("blocked");
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.UserAgent = "YouPlay/" + Program.Version; req.Timeout = 20000;
                using (var resp = (HttpWebResponse)req.GetResponse())
                using (var r = new StreamReader(resp.GetResponseStream(), Encoding.UTF8)) { status = (int)resp.StatusCode; body = r.ReadToEnd(); }
            }
            catch (WebException we) { var hr = we.Response as HttpWebResponse; status = hr != null ? (int)hr.StatusCode : 0; }
            catch { }
            BeginInvoke((Action)(() => PostUi(new Dictionary<string, object> { { "t", "fetch" }, { "id", id }, { "status", status }, { "body", body } })));
        });
    }

    // ── Моя музыка: audio files from the Music folder ──
    string MusicFolder()
    {
        try { var p = File.ReadAllText(folderFile).Trim(); if (Directory.Exists(p)) return p; } catch { }
        return Environment.GetFolderPath(Environment.SpecialFolder.MyMusic);
    }
    void PickFolder()
    {
        using (var d = new FolderBrowserDialog { Description = "Папка с музыкой для YouPlay", SelectedPath = MusicFolder() })
            if (d.ShowDialog(this) == DialogResult.OK) { File.WriteAllText(folderFile, d.SelectedPath); ui.CoreWebView2.ExecuteScriptAsync("window.__ypLocalReload && window.__ypLocalReload()"); }
    }
    List<Dictionary<string, object>> ScanLocal()
    {
        var list = new List<Dictionary<string, object>>();
        lock (localFiles)
        {
            localFiles.Clear();
            try
            {
                foreach (var f in Directory.EnumerateFiles(MusicFolder(), "*.*", SearchOption.AllDirectories))
                {
                    var ext = Path.GetExtension(f).ToLowerInvariant();
                    if (ext != ".mp3" && ext != ".m4a" && ext != ".aac" && ext != ".flac" && ext != ".ogg" && ext != ".opus" && ext != ".wav") continue;
                    if (localFiles.Count >= 8000) break;
                    string title, artist, album; Tags.Read(f, out title, out artist, out album);
                    var id = localFiles.Count; localFiles.Add(f);
                    list.Add(new Dictionary<string, object> { { "id", id.ToString() }, { "title", title }, { "artist", artist }, { "album", album }, { "duration", 0 }, { "url", "https://youplay.local/media/" + id } });
                }
            }
            catch { }
        }
        return list;
    }

    // ── https://youplay.local/... : the interface files and local media (with HTTP ranges for seeking) ──
    void OnLocalRequest(object sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        try
        {
            var uri = new Uri(e.Request.Uri);
            string path = Uri.UnescapeDataString(uri.AbsolutePath);
            if (path.StartsWith("/media/"))
            {
                int idx; string file = null;
                lock (localFiles) { if (int.TryParse(path.Substring(7), out idx) && idx >= 0 && idx < localFiles.Count) file = localFiles[idx]; }
                if (file == null) { e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", ""); return; }
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
                    var part = new SubStream(fs, end - start + 1);
                    e.Response = env.CreateWebResourceResponse(part, 206, "Partial Content",
                        "Content-Type: " + mime + "\r\nAccept-Ranges: bytes\r\nContent-Range: bytes " + start + "-" + end + "/" + size + "\r\nContent-Length: " + (end - start + 1));
                }
                else e.Response = env.CreateWebResourceResponse(fs, 200, "OK", "Content-Type: " + mime + "\r\nAccept-Ranges: bytes\r\nContent-Length: " + size);
                return;
            }
            if (path == "/" || path == "") path = "/index.html";
            string root = Path.GetFullPath(Path.Combine(Program.Dir, "app"));
            string full = Path.GetFullPath(Path.Combine(root, path.TrimStart('/').Replace('/', '\\')));
            if (!full.StartsWith(root) || !File.Exists(full)) { e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", ""); return; }
            e.Response = env.CreateWebResourceResponse(new MemoryStream(File.ReadAllBytes(full)), 200, "OK", "Content-Type: " + Mime(full) + "\r\nCache-Control: no-cache");
        }
        catch { e.Response = env.CreateWebResourceResponse(null, 500, "Error", ""); }
    }
    static string Mime(string f)
    {
        switch (Path.GetExtension(f).ToLowerInvariant())
        {
            case ".html": return "text/html; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".js": return "application/javascript; charset=utf-8";
            case ".png": return "image/png";
            case ".svg": return "image/svg+xml";
            case ".mp3": return "audio/mpeg";
            case ".m4a": case ".aac": return "audio/mp4";
            case ".flac": return "audio/flac";
            case ".ogg": case ".opus": return "audio/ogg";
            case ".wav": return "audio/wav";
            default: return "application/octet-stream";
        }
    }

    // ── updates ──
    void PostUpdate() { PostUi(new Dictionary<string, object> { { "t", "update" }, { "state", Updater.State }, { "version", Updater.LatestTag ?? "" }, { "current", Program.Version }, { "percent", Updater.Percent } }); }
    void UpdateNow()
    {
        if (Updater.State != "available" || Updater.LatestUrl == null) { PostUpdate(); return; }
        Updater.State = "downloading"; Updater.Percent = 0; PostUpdate();
        string dir = Path.Combine(Program.Data, "Updates"); Directory.CreateDirectory(dir);
        string file = Path.Combine(dir, "YouPlay-Setup-" + Updater.LatestTag + ".exe");
        var wc = new WebClient(); wc.Headers.Add("User-Agent", "YouPlay");
        wc.DownloadProgressChanged += (s, e) => { if (e.ProgressPercentage != Updater.Percent) { Updater.Percent = e.ProgressPercentage; BeginInvoke((Action)PostUpdate); } };
        wc.DownloadFileCompleted += (s, e) => BeginInvoke((Action)(() =>
        {
            wc.Dispose();
            if (e.Error != null || e.Cancelled) { Updater.State = "error"; PostUpdate(); return; }
            try
            {
                if (File.Exists(file)) File.Delete(file);
                File.Move(file + ".part", file);
                Updater.State = "installing"; PostUpdate();
                Process.Start(new ProcessStartInfo(file, "/S") { UseShellExecute = false });
                var t = new System.Windows.Forms.Timer { Interval = 900 }; t.Tick += (a, b) => { t.Stop(); Close(); }; t.Start();
            }
            catch { Updater.State = "error"; PostUpdate(); }
        }));
        ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;
        wc.DownloadFileAsync(new Uri(Updater.LatestUrl), file + ".part");
    }

    // ── window ──
    void ToggleFullscreen()
    {
        if (!isFull) { prevState = WindowState; prevBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds; isFull = true; WindowState = FormWindowState.Normal; FormBorderStyle = FormBorderStyle.None; Bounds = Screen.FromControl(this).Bounds; }
        else { isFull = false; FormBorderStyle = FormBorderStyle.Sizable; Bounds = prevBounds; WindowState = prevState; }
    }
    void RestoreBounds_()
    {
        Size = new Size(1280, 820);
        var wa = Screen.PrimaryScreen.WorkingArea;
        Location = new Point(wa.Left + Math.Max(0, (wa.Width - Width) / 2), wa.Top + Math.Max(0, (wa.Height - Height) / 2));
        try
        {
            var p = File.ReadAllText(boundsFile).Split(',');
            var r = new Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
            foreach (var s in Screen.AllScreens) if (s.WorkingArea.IntersectsWith(r)) { Bounds = r; break; }
            if (p.Length > 4 && p[4] == "max") WindowState = FormWindowState.Maximized;
        }
        catch { if (wa.Width < 1350 || wa.Height < 860) WindowState = FormWindowState.Maximized; }
    }
    void SaveBounds()
    {
        try { var r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds; File.WriteAllText(boundsFile, string.Format("{0},{1},{2},{3},{4}", r.X, r.Y, r.Width, r.Height, WindowState == FormWindowState.Maximized ? "max" : "normal")); } catch { }
    }
}

// A window onto part of a stream (for HTTP range responses).
class SubStream : Stream
{
    readonly Stream s; long left;
    public SubStream(Stream s, long length) { this.s = s; left = length; }
    public override bool CanRead { get { return true; } }
    public override bool CanSeek { get { return false; } }
    public override bool CanWrite { get { return false; } }
    public override long Length { get { return left; } }
    public override long Position { get { return 0; } set { } }
    public override int Read(byte[] buf, int off, int count) { if (left <= 0) return 0; int n = s.Read(buf, off, (int)Math.Min(count, left)); left -= n; return n; }
    public override void Flush() { }
    public override long Seek(long o, SeekOrigin so) { throw new NotSupportedException(); }
    public override void SetLength(long v) { throw new NotSupportedException(); }
    public override void Write(byte[] b, int o, int c) { throw new NotSupportedException(); }
    protected override void Dispose(bool d) { if (d) s.Dispose(); base.Dispose(d); }
}

// Minimal ID3v2 reader for title / artist / album (falls back to "Artist - Title" file names).
static class Tags
{
    public static void Read(string file, out string title, out string artist, out string album)
    {
        title = null; artist = null; album = null;
        try
        {
            using (var f = File.OpenRead(file))
            {
                var h = new byte[10];
                if (f.Read(h, 0, 10) == 10 && h[0] == 'I' && h[1] == 'D' && h[2] == '3')
                {
                    int ver = h[3];
                    int size = (h[6] << 21) | (h[7] << 14) | (h[8] << 7) | h[9];
                    var tag = new byte[Math.Min(size, 1 << 20)];
                    f.Read(tag, 0, tag.Length);
                    int p = 0;
                    while (p + 10 < tag.Length)
                    {
                        string id = Encoding.ASCII.GetString(tag, p, 4);
                        if (id[0] == 0) break;
                        int fs = ver >= 4 ? ((tag[p + 4] << 21) | (tag[p + 5] << 14) | (tag[p + 6] << 7) | tag[p + 7]) : ((tag[p + 4] << 24) | (tag[p + 5] << 16) | (tag[p + 6] << 8) | tag[p + 7]);
                        if (fs <= 0 || p + 10 + fs > tag.Length) break;
                        if (id == "TIT2" || id == "TPE1" || id == "TALB")
                        {
                            int enc = tag[p + 10];
                            Encoding e = enc == 1 ? Encoding.Unicode : enc == 2 ? Encoding.BigEndianUnicode : enc == 3 ? Encoding.UTF8 : Encoding.GetEncoding(1251);
                            int off = p + 11, len = fs - 1;
                            if (enc == 1 && len >= 2 && tag[off] == 0xFE && tag[off + 1] == 0xFF) { e = Encoding.BigEndianUnicode; off += 2; len -= 2; }
                            else if (enc == 1 && len >= 2 && tag[off] == 0xFF && tag[off + 1] == 0xFE) { off += 2; len -= 2; }
                            string v = e.GetString(tag, off, len).Trim('\0', ' ');
                            if (id == "TIT2") title = v; else if (id == "TPE1") artist = v; else album = v;
                        }
                        p += 10 + fs;
                    }
                }
            }
        }
        catch { }
        if (string.IsNullOrEmpty(title))
        {
            var name = Path.GetFileNameWithoutExtension(file);
            var k = name.IndexOf(" - ");
            if (k > 0) { if (string.IsNullOrEmpty(artist)) artist = name.Substring(0, k).Trim(); title = name.Substring(k + 3).Trim(); } else title = name;
        }
        if (string.IsNullOrEmpty(artist)) artist = "Неизвестный исполнитель";
        if (album == null) album = "";
    }
}

static class Updater
{
    public static bool Enabled = true;
    public static string State = "idle";
    public static string LatestTag, LatestUrl;
    public static int Percent;
    public static void Check()
    {
        if (!Enabled) { State = "dev"; return; }
        ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;
        using (var wc = new WebClient())
        {
            wc.Headers.Add("User-Agent", "YouPlay");
            wc.Headers.Add("Accept", "application/vnd.github+json");
            string j = wc.DownloadString("https://api.github.com/repos/" + Program.Repo + "/releases/latest");
            string tag = Regex.Match(j, "\"tag_name\"\\s*:\\s*\"v?([0-9]+(\\.[0-9]+){1,3})\"").Groups[1].Value;
            string url = Regex.Match(j, "\"browser_download_url\"\\s*:\\s*\"(https://[^\"]*/YouPlay-Setup-[^\"]*\\.exe)\"").Groups[1].Value;
            if (tag.Length > 0 && url.Length > 0 && new Version(tag) > new Version(Program.Version)) { LatestTag = tag; LatestUrl = url; State = "available"; }
            else State = "none";
        }
    }
}
