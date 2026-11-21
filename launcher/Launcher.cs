// YouPlay — native Windows window hosting YouTube Music in WebView2 (the Microsoft Edge engine
// built into Windows) with the YouPlay extension. Own window, icon, taskbar entry and dark title bar;
// checks GitHub Releases on every start and installs updates silently in the background.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
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

    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);

    [STAThread]
    static void Main(string[] args)
    {
        bool first;
        using (var mutex = new Mutex(true, "YouPlay.SingleInstance." + Data.GetHashCode().ToString("x"), out first))
        {
            if (!first)
            {
                var w = FindWindow(null, "YouPlay");
                if (w != IntPtr.Zero) { ShowWindow(w, 9); SetForegroundWindow(w); }
                return;
            }
            Directory.CreateDirectory(Data);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Updater.Enabled = Array.IndexOf(args, "--no-update") < 0;
            Application.Run(new MainWindow());
        }
    }
}

class MainWindow : Form
{
    readonly WebView2 web = new WebView2();
    readonly WebView2 sc = new WebView2();         // hidden soundcloud.com page: search results + likes for YouPlay
    CoreWebView2Environment env;
    readonly System.Collections.Generic.Queue<string[]> scJobs = new System.Collections.Generic.Queue<string[]>();
    string scBusy = null;
    readonly System.Windows.Forms.Timer scTimer = new System.Windows.Forms.Timer();
    bool isFull; FormWindowState prevState; Rectangle prevBounds;
    readonly string boundsFile = Path.Combine(Program.Data, "window.txt");

    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    public MainWindow()
    {
        Text = "YouPlay";
        try { Icon = new Icon(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "icon.ico")); } catch { }
        BackColor = Color.FromArgb(18, 13, 11);
        MinimumSize = new Size(960, 600);
        StartPosition = FormStartPosition.Manual;
        RestoreBounds_();
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = Color.FromArgb(18, 13, 11);
        // the SoundCloud page lives behind the main view: rendered (so its lists load) but never seen
        sc.Dock = DockStyle.None;
        sc.Location = new Point(0, 0);
        sc.Size = new Size(1100, 900);
        sc.DefaultBackgroundColor = Color.FromArgb(18, 13, 11);
        Controls.Add(sc);
        Controls.Add(web);
        web.BringToFront();
        scTimer.Interval = 30000;
        scTimer.Tick += (s, e) => { scTimer.Stop(); if (scBusy != null) { PostToYt("{\"ypScData\":{\"id\":" + JsString(scBusy) + ",\"error\":\"timeout\"}}"); scBusy = null; ScNext(); } };
        KeyPreview = true;
        KeyDown += (s, e) => { if (e.KeyCode == Keys.F11) ToggleFullscreen(); else if (e.KeyCode == Keys.Escape && isFull) ToggleFullscreen(); };
        Load += async (s, e) => await InitWeb();
        FormClosing += (s, e) => SaveBounds();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        SetCaption(0x0B0D12); // BGR of #120d0b
    }

    // Windows 11: dark title bar in the theme colour
    void SetCaption(int bgr)
    {
        try
        {
            int dark = 1; DwmSetWindowAttribute(Handle, 20, ref dark, 4);
            int c = bgr; DwmSetWindowAttribute(Handle, 35, ref c, 4);          // caption colour
            int t = 0x00EAEEF4; DwmSetWindowAttribute(Handle, 36, ref t, 4);   // caption text
            int b = bgr; DwmSetWindowAttribute(Handle, 34, ref b, 4);          // border
        }
        catch { }
    }

    async Task InitWeb()
    {
        try
        {
            var opts = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required" + DebugArgs());
            opts.AreBrowserExtensionsEnabled = true;
            env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.Data, "WebView2"), opts);
            await web.EnsureCoreWebView2Async(env);
        }
        catch (Exception ex)
        {
            MessageBox.Show("Не удалось запустить движок WebView2: " + ex.Message +
                "\n\nУстановите «Microsoft Edge WebView2 Runtime» с сайта Microsoft и запустите YouPlay снова.", "YouPlay");
            Close(); return;
        }
        var core = web.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = true;
        core.Settings.AreDevToolsEnabled = true;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;

        try
        {
            string ext = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "extension");
            var profile = core.Profile;
            var installed = await profile.GetBrowserExtensionsAsync();
            string marker = Path.Combine(Program.Data, "extension-version.txt");
            string had = File.Exists(marker) ? File.ReadAllText(marker).Trim() : "";
            bool present = false;
            foreach (var x in installed)
            {
                if (x.Name != "YouPlay") continue;
                if (had != Program.Version) await x.RemoveAsync();          // new version: load the new files
                else { present = true; if (!x.IsEnabled) await x.EnableAsync(true); }
            }
            if (!present) await profile.AddBrowserExtensionAsync(ext);
            File.WriteAllText(marker, Program.Version);
        }
        catch (Exception ex) { Debug.WriteLine("extension: " + ex.Message); }

        // links that leave YouTube / Google open in the normal browser; sign-in popups stay inside
        core.NewWindowRequested += (s, e) =>
        {
            if (IsInside(e.Uri)) { e.Handled = true; core.Navigate(e.Uri); }
            else { e.Handled = true; OpenExternal(e.Uri); }
        };
        core.NavigationStarting += (s, e) =>
        {
            if (!IsInside(e.Uri)) { e.Cancel = true; OpenExternal(e.Uri); }
        };
        core.NavigationCompleted += (s, e) =>
        {
            // after sign-in Google may land on youtube.com — return to YouTube Music
            var u = core.Source ?? "";
            if (Regex.IsMatch(u, @"^https://(www\.)?youtube\.com/?(\?|$|feed)")) core.Navigate("https://music.youtube.com/");
        };
        core.DocumentTitleChanged += (s, e) =>
        {
            var t = core.DocumentTitle ?? "";
            t = Regex.Replace(t, @"\s*[-–]\s*YouTube Music\s*$", "");
            Text = string.IsNullOrWhiteSpace(t) || t == "YouTube Music" ? "YouPlay" : t + " — YouPlay";
        };
        core.WebMessageReceived += (s, e) => { try { OnMessage(e.TryGetWebMessageAsString() ?? ""); } catch { } };
        core.ContainsFullScreenElementChanged += (s, e) => { if (core.ContainsFullScreenElement != isFull) ToggleFullscreen(); };
        core.Navigate("https://music.youtube.com/");
        if (Updater.Enabled) Task.Run(() => { Thread.Sleep(3000); try { Updater.Check(); } catch { Updater.State = "error"; } BeginInvoke((Action)PostUpdateState); });
    }

    // ── updates: ask in the app, then download → close cleanly → install → reopen ──
    void PostUpdateState()
    {
        string v = Updater.LatestTag ?? "";
        PostToYt("{\"ypUpdate\":{\"state\":" + JsString(Updater.State) + ",\"version\":" + JsString(v) + ",\"current\":" + JsString(Program.Version) + ",\"percent\":" + Updater.Percent + "}}");
    }
    void UpdateNow()
    {
        if (Updater.State != "available" || Updater.LatestUrl == null) { PostUpdateState(); return; }
        Updater.State = "downloading"; Updater.Percent = 0; PostUpdateState();
        string dir = Path.Combine(Program.Data, "Updates");
        Directory.CreateDirectory(dir);
        string file = Path.Combine(dir, "YouPlay-Setup-" + Updater.LatestTag + ".exe");
        var wc = new WebClient();
        wc.Headers.Add("User-Agent", "YouPlay");
        wc.DownloadProgressChanged += (s, e) => { if (e.ProgressPercentage != Updater.Percent) { Updater.Percent = e.ProgressPercentage; BeginInvoke((Action)PostUpdateState); } };
        wc.DownloadFileCompleted += (s, e) => BeginInvoke((Action)(() =>
        {
            wc.Dispose();
            if (e.Error != null || e.Cancelled) { Updater.State = "error"; PostUpdateState(); return; }
            try
            {
                if (File.Exists(file)) File.Delete(file);
                File.Move(file + ".part", file);
                Updater.State = "installing"; PostUpdateState();
                // the installer waits until this window has closed, installs silently and starts YouPlay again
                Process.Start(new ProcessStartInfo(file, "/S /wait=" + Process.GetCurrentProcess().Id) { UseShellExecute = false });
                var t = new System.Windows.Forms.Timer { Interval = 900 };
                t.Tick += (a, b) => { t.Stop(); Close(); };
                t.Start();
            }
            catch { Updater.State = "error"; PostUpdateState(); }
        }));
        ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;
        wc.DownloadFileAsync(new Uri(Updater.LatestUrl), file + ".part");
    }

    async void ScLogout()
    {
        try
        {
            var cm = web.CoreWebView2.CookieManager;
            foreach (var host in new[] { "https://soundcloud.com", "https://secure.soundcloud.com", "https://api-auth.soundcloud.com", "https://api-v2.soundcloud.com" })
            {
                var list = await cm.GetCookiesAsync(host);
                foreach (var c in list) cm.DeleteCookie(c);
            }
        }
        catch { }
        PostToYt("{\"ypScLogout\":true}");
    }

    void OnMessage(string msg)
    {
        var m = Regex.Match(msg, "^caption:#([0-9a-fA-F]{6})$");
        if (m.Success)
        {
            int rgb = Convert.ToInt32(m.Groups[1].Value, 16);
            int bgr = ((rgb & 0xFF) << 16) | (rgb & 0xFF00) | ((rgb >> 16) & 0xFF);
            SetCaption(bgr);
            var c = Color.FromArgb((rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF);
            BackColor = c;
            return;
        }
        if (msg == "fullscreen") { ToggleFullscreen(); return; }
        // YouTube Music page asks for SoundCloud data: sc:<op>:<id>:<arg>
        var j = Regex.Match(msg, "^sc:(search|likes|like|unlike|status):([A-Za-z0-9_-]{1,40}):(.*)$", RegexOptions.Singleline);
        if (j.Success) { scJobs.Enqueue(new[] { j.Groups[1].Value, j.Groups[2].Value, j.Groups[3].Value }); if (scBusy == null) ScNext(); return; }
        if (msg == "sclogin") { ScLogin(); return; }
        if (msg == "sclogout") { ScLogout(); return; }
        if (msg == "update-status") { PostUpdateState(); return; }
        if (msg == "update-check") { if (!Updater.Enabled) { Updater.State = "dev"; PostUpdateState(); return; } Updater.State = "checking"; PostUpdateState(); Task.Run(() => { try { Updater.Check(); } catch { Updater.State = "error"; } BeginInvoke((Action)PostUpdateState); }); return; }
        if (msg == "update-now") { UpdateNow(); return; }
        // the hidden SoundCloud page answers: scdata:{json}
        if (msg.StartsWith("scdata:"))
        {
            var json = msg.Substring(7);
            var idm = Regex.Match(json, "\"id\"\\s*:\\s*\"([A-Za-z0-9_-]+)\"");
            PostToYt("{\"ypScData\":" + json + "}");
            if (idm.Success && idm.Groups[1].Value == scBusy) { scTimer.Stop(); scBusy = null; ScNext(); }
        }
    }

    void PostToYt(string json)
    {
        try { if (web.CoreWebView2 != null) web.CoreWebView2.ExecuteScriptAsync("window.postMessage(" + json + ", 'https://music.youtube.com');"); } catch { }
    }

    static string JsString(string v) { return "\"" + v.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""; }

    // ── hidden SoundCloud page: one job at a time ──
    async void ScNext()
    {
        if (scBusy != null || scJobs.Count == 0) return;
        var job = scJobs.Dequeue();
        string op = job[0], id = job[1], arg = job[2];
        string url;
        if (op == "search") url = "https://soundcloud.com/search/sounds?q=" + Uri.EscapeDataString(arg) + "&yp=" + id + "#yp=search:" + id;
        else if (op == "likes") url = "https://soundcloud.com/you/likes?yp=" + id + "#yp=likes:" + id;
        else if (op == "status") url = "https://soundcloud.com/you/library?yp=" + id + "#yp=status:" + id;
        else if (IsSoundCloud(arg) && arg.StartsWith("https://")) url = arg.Split('#')[0] + (arg.Contains("?") ? "&" : "?") + "yp=" + id + "#yp=" + op + ":" + id;
        else { PostToYt("{\"ypScData\":{\"id\":" + JsString(id) + ",\"error\":\"bad\"}}"); ScNext(); return; }
        scBusy = id;
        if (sc.CoreWebView2 == null)
        {
            try { await sc.EnsureCoreWebView2Async(env); }
            catch { scBusy = null; return; }
            var core = sc.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.AreDefaultScriptDialogsEnabled = false;
            core.IsMuted = true;                                   // never makes a sound
            core.WebMessageReceived += (s, e) => { try { OnMessage(e.TryGetWebMessageAsString() ?? ""); } catch { } };
            core.NewWindowRequested += (s, e) => { e.Handled = true; };
            core.NavigationStarting += (s, e) => { if (!IsSoundCloud(e.Uri)) e.Cancel = true; };
        }
        scTimer.Stop(); scTimer.Start();
        sc.CoreWebView2.Navigate(url);
    }

    // ── SoundCloud sign-in window (the real soundcloud.com sign-in page) ──
    Form scLoginForm;
    async void ScLogin()
    {
        if (scLoginForm != null && !scLoginForm.IsDisposed) { scLoginForm.Activate(); return; }
        var f = new Form { Text = "Вход в SoundCloud — YouPlay", Size = new Size(560, 780), StartPosition = FormStartPosition.CenterParent, Icon = Icon, BackColor = BackColor };
        var w = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(18, 13, 11) };
        f.Controls.Add(w);
        scLoginForm = f;
        bool ok = false;
        f.FormClosed += (s, e) => PostToYt("{\"ypScLogin\":" + (ok ? "true" : "false") + "}");
        f.Show(this);
        try { await w.EnsureCoreWebView2Async(env); } catch { f.Close(); return; }
        w.CoreWebView2.NavigationCompleted += async (s, e) =>
        {
            try
            {
                var u = w.CoreWebView2.Source ?? "";
                if (!Regex.IsMatch(u, "^https://(www\\.)?soundcloud\\.com/") || u.Contains("/signin")) return;
                var cookies = await w.CoreWebView2.CookieManager.GetCookiesAsync("https://soundcloud.com");
                foreach (var c in cookies) if (c.Name == "oauth_token" && c.Value.Length > 0) { ok = true; f.Close(); return; }
            }
            catch { }
        };
        w.CoreWebView2.Navigate("https://soundcloud.com/signin");
    }

    static bool IsSoundCloud(string url)
    {
        try { var h = new Uri(url).Host.ToLowerInvariant(); return Regex.IsMatch(h, @"(^|\.)(soundcloud\.com|sndcdn\.com|soundcloud\.cloud)$") || url.StartsWith("about:"); }
        catch { return false; }
    }

    // ── F11 / YouTube Music fullscreen ──
    void ToggleFullscreen()
    {
        if (!isFull)
        {
            prevState = WindowState; prevBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            isFull = true;
            WindowState = FormWindowState.Normal;
            FormBorderStyle = FormBorderStyle.None;
            Bounds = Screen.FromControl(this).Bounds;
        }
        else
        {
            isFull = false;
            FormBorderStyle = FormBorderStyle.Sizable;
            Bounds = prevBounds;
            WindowState = prevState;
            SetCaption(0x0B0D12);
        }
    }

    static string DebugArgs()
    {
        var p = Environment.GetEnvironmentVariable("YOUPLAY_DEBUG_PORT");
        return string.IsNullOrEmpty(p) ? "" : " --remote-debugging-port=" + p;
    }

    static bool IsInside(string url)
    {
        try
        {
            var h = new Uri(url).Host.ToLowerInvariant();
            return Regex.IsMatch(h, @"(^|\.)(youtube\.com|google\.com|google\.[a-z.]+|gstatic\.com|googleusercontent\.com|youtube-nocookie\.com)$");
        }
        catch { return true; }
    }

    static void OpenExternal(string url)
    {
        try { if (url.StartsWith("https://") || url.StartsWith("http://")) Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }

    void RestoreBounds_()
    {
        Size = new Size(1360, 860);
        var wa = Screen.PrimaryScreen.WorkingArea;
        Location = new Point(wa.Left + Math.Max(0, (wa.Width - Width) / 2), wa.Top + Math.Max(0, (wa.Height - Height) / 2));
        try
        {
            var p = File.ReadAllText(boundsFile).Split(',');
            var r = new Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
            foreach (var s in Screen.AllScreens)
                if (s.WorkingArea.IntersectsWith(r)) { Bounds = r; break; }
            if (p.Length > 4 && p[4] == "max") WindowState = FormWindowState.Maximized;
        }
        catch { if (wa.Width < 1400 || wa.Height < 900) WindowState = FormWindowState.Maximized; }
    }

    void SaveBounds()
    {
        try
        {
            var r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            File.WriteAllText(boundsFile, string.Format("{0},{1},{2},{3},{4}", r.X, r.Y, r.Width, r.Height, WindowState == FormWindowState.Maximized ? "max" : "normal"));
        }
        catch { }
    }
}

static class Updater
{
    public static bool Enabled = true;
    public static string State = "idle";       // idle | checking | none | available | downloading | installing | error | dev
    public static string LatestTag, LatestUrl;
    public static int Percent;
    public static void Check()
    {
        if (!Enabled) { State = "dev"; return; }
        ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2
        using (var wc = new WebClient())
        {
            wc.Headers.Add("User-Agent", "YouPlay");
            wc.Headers.Add("Accept", "application/vnd.github+json");
            string json = wc.DownloadString("https://api.github.com/repos/" + Program.Repo + "/releases/latest");
            string tag = Regex.Match(json, "\"tag_name\"\\s*:\\s*\"v?([0-9]+(\\.[0-9]+){1,3})\"").Groups[1].Value;
            string url = Regex.Match(json, "\"browser_download_url\"\\s*:\\s*\"(https://[^\"]*/YouPlay-Setup-[^\"]*\\.exe)\"").Groups[1].Value;
            if (tag.Length > 0 && url.Length > 0 && new Version(tag) > new Version(Program.Version)) { LatestTag = tag; LatestUrl = url; State = "available"; }
            else State = "none";
        }
    }
}
