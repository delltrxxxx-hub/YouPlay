// YouPlay 3 for Windows — a native WPF app. YouTube Music and SoundCloud run only as hidden music sources.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows;

[assembly: AssemblyTitle("YouPlay")]
[assembly: AssemblyProduct("YouPlay")]
[assembly: AssemblyVersion("__VERSION__.0")]
[assembly: AssemblyFileVersion("__VERSION__.0")]

namespace YouPlay
{
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
                var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
                app.DispatcherUnhandledException += (s, e) => { try { File.AppendAllText(Path.Combine(Data, "errors.log"), DateTime.Now + " " + e.Exception + "\r\n"); } catch { } e.Handled = true; };
                var w = new MainWindow();
                app.Run(w);
            }
        }
    }

    /// <summary>JSON helpers over JavaScriptSerializer (objects → Dictionary, arrays → object[] / ArrayList).</summary>
    static class J
    {
        public static readonly JavaScriptSerializer Ser = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024, RecursionLimit = 200 };
        public static Dictionary<string, object> Parse(string s) { try { return Ser.DeserializeObject(s) as Dictionary<string, object> ?? new Dictionary<string, object>(); } catch { return new Dictionary<string, object>(); } }
        public static string Str(object o) { return Ser.Serialize(o); }
        public static string S(Dictionary<string, object> d, string k) { object v; return d != null && d.TryGetValue(k, out v) && v != null ? Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture) : ""; }
        public static double D(Dictionary<string, object> d, string k) { object v; if (d == null || !d.TryGetValue(k, out v) || v == null) return 0; try { return Convert.ToDouble(v, System.Globalization.CultureInfo.InvariantCulture); } catch { return 0; } }
        public static bool B(Dictionary<string, object> d, string k) { object v; return d != null && d.TryGetValue(k, out v) && v is bool && (bool)v; }
        public static bool Has(Dictionary<string, object> d, string k) { return d != null && d.ContainsKey(k) && d[k] != null; }
        public static Dictionary<string, object> O(Dictionary<string, object> d, string k) { object v; return d != null && d.TryGetValue(k, out v) ? v as Dictionary<string, object> : null; }
        public static List<Dictionary<string, object>> A(Dictionary<string, object> d, string k)
        {
            object v; var list = new List<Dictionary<string, object>>();
            if (d == null || !d.TryGetValue(k, out v) || v == null) return list;
            var e = v as IEnumerable; if (e == null || v is string) return list;
            foreach (var x in e) { var o = x as Dictionary<string, object>; if (o != null) list.Add(o); }
            return list;
        }
        public static List<string> Strs(Dictionary<string, object> d, string k)
        {
            object v; var list = new List<string>();
            if (d == null || !d.TryGetValue(k, out v) || v == null || v is string) return list;
            var e = v as IEnumerable; if (e == null) return list;
            foreach (var x in e) if (x != null) list.Add(x.ToString());
            return list;
        }
        public static Dictionary<string, object> Make(params object[] kv) { var d = new Dictionary<string, object>(); for (int i = 0; i + 1 < kv.Length; i += 2) d[(string)kv[i]] = kv[i + 1]; return d; }
    }

    /// <summary>Settings and cached data, saved in %LOCALAPPDATA%\YouPlay\youplay.json (kept across updates).</summary>
    static class Store
    {
        static readonly string file = Path.Combine(Program.Data, "youplay.json");
        public static Dictionary<string, object> Data = Load();
        static Dictionary<string, object> Load() { try { return J.Parse(File.ReadAllText(file, Encoding.UTF8)); } catch { return new Dictionary<string, object>(); } }
        static Timer saveTimer;
        public static void Save()
        {
            if (saveTimer != null) saveTimer.Dispose();
            saveTimer = new Timer(_ => SaveNow(), null, 400, Timeout.Infinite);
        }
        public static void SaveNow()
        {
            try { string s; lock (Data) s = J.Str(Data); File.WriteAllText(file + ".tmp", s, Encoding.UTF8); if (File.Exists(file)) File.Delete(file); File.Move(file + ".tmp", file); } catch { }
        }
        public static string Get(string k, string def) { lock (Data) { var s = J.S(Data, k); return s.Length > 0 ? s : def; } }
        public static bool Bool(string k, bool def) { lock (Data) { object v; return Data.TryGetValue(k, out v) && v is bool ? (bool)v : def; } }
        public static double Num(string k, double def) { lock (Data) return Data.ContainsKey(k) ? J.D(Data, k) : def; }
        public static void Set(string k, object v) { lock (Data) Data[k] = v; Save(); }
        public static List<Dictionary<string, object>> List(string k) { lock (Data) return J.A(Data, k); }
        public static void SetList(string k, List<Dictionary<string, object>> v) { lock (Data) Data[k] = v.ToArray(); Save(); }
        public static Dictionary<string, object> Obj(string k) { lock (Data) return J.O(Data, k); }
    }

    /// <summary>One track (or a card that opens a page) from YouTube Music, SoundCloud or a file.</summary>
    class Track
    {
        public string Src = "yt", Kind = "song", VideoId, Url, Id, Title = "", Artist = "", Art = "", DurText = "", Browse, LikedAt;
        public double Duration; public bool Liked, Disliked, Round;
        public string Key { get { return Src == "sc" ? "sc:" + Url : Src == "local" ? "local:" + Id : "yt:" + VideoId; } }
        public bool Playable { get { return (Src == "yt" && !string.IsNullOrEmpty(VideoId)) || (Src == "sc" && !string.IsNullOrEmpty(Url)) || (Src == "local" && !string.IsNullOrEmpty(Id)); } }
        static readonly Regex KindRe = new Regex(@"^\s*(композиция|песня|трек|song|track|видео|video|клип|сингл|single|ep|альбом|album|плейлист|playlist)\s*[•·]\s*", RegexOptions.IgnoreCase);
        public static string CleanArtist(string a) { return KindRe.Replace(a ?? "", ""); }
        static string N(Dictionary<string, object> o, string k) { var s = J.S(o, k); return s.Length > 0 ? s : null; }
        public static Track From(Dictionary<string, object> o, string defSrc)
        {
            var t = new Track();
            t.Src = J.S(o, "src"); if (t.Src.Length == 0) t.Src = defSrc;
            t.Kind = J.S(o, "kind"); if (t.Kind.Length == 0) t.Kind = "song";
            t.VideoId = N(o, "videoId"); t.Url = N(o, "url"); t.Id = N(o, "id");
            t.Title = J.S(o, "title"); t.Artist = CleanArtist(J.S(o, "artist")); t.Art = J.S(o, "art");
            t.DurText = J.S(o, "durText"); t.Browse = N(o, "browse"); t.LikedAt = N(o, "likedAt");
            t.Duration = J.D(o, "duration"); if (t.Duration > 100000) t.Duration /= 1000;
            t.Round = J.B(o, "round");
            return t;
        }
        public static List<Track> List(IEnumerable<Dictionary<string, object>> a, string defSrc) { var l = new List<Track>(); foreach (var o in a) l.Add(From(o, defSrc)); return l; }
        public Dictionary<string, object> Json()
        {
            var d = J.Make("src", Src, "kind", Kind, "videoId", VideoId, "url", Url, "id", Id, "title", Title, "artist", Artist, "art", Art, "durText", DurText, "duration", Duration);
            if (LikedAt != null) d["likedAt"] = LikedAt;
            return d;
        }
        public Track Copy() { return From(Json(), Src); }
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

    /// <summary>A window onto part of a stream (for HTTP range responses).</summary>
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

    static class Http
    {
        public static System.Threading.Tasks.Task<Dictionary<string, object>> Get(string url)
        {
            return System.Threading.Tasks.Task.Run(() =>
            {
                int status = 0; string body = "";
                try
                {
                    ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;
                    var req = (HttpWebRequest)WebRequest.Create(url);
                    req.UserAgent = "YouPlay/" + Program.Version; req.Timeout = 15000;
                    using (var resp = (HttpWebResponse)req.GetResponse())
                    using (var r = new StreamReader(resp.GetResponseStream(), Encoding.UTF8)) { status = (int)resp.StatusCode; body = r.ReadToEnd(); }
                }
                catch (WebException we) { var hr = we.Response as HttpWebResponse; status = hr != null ? (int)hr.StatusCode : 0; }
                catch { }
                return J.Make("status", status, "body", body);
            });
        }
        public static string Enc(string s) { return Uri.EscapeDataString(s ?? ""); }
    }
}
