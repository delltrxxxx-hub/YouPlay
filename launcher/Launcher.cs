// YouPlay launcher: opens YouTube Music in its own Microsoft Edge app window with the YouPlay
// extension, then checks GitHub Releases for a newer YouPlay and installs it silently in the background.
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("YouPlay")]
[assembly: AssemblyProduct("YouPlay")]
[assembly: AssemblyVersion("__VERSION__.0")]
[assembly: AssemblyFileVersion("__VERSION__.0")]

static class YouPlay
{
    const string Version = "__VERSION__";
    const string Repo = "delltrxxxx-hub/YouPlay";
    const string Url = "https://music.youtube.com/";

    [STAThread]
    static void Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string edge = FindEdge();
        if (edge == null)
        {
            MessageBox.Show("Для работы YouPlay нужен Microsoft Edge. Установите его с microsoft.com/edge и запустите YouPlay снова.",
                "YouPlay", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "YouPlay");
        string profile = Path.Combine(data, "Profile");
        Directory.CreateDirectory(profile);
        string ext = Path.Combine(dir, "extension");

        string a = "--app=" + Url +
                   " --user-data-dir=\"" + profile + "\"" +
                   " --load-extension=\"" + ext + "\"" +
                   " --no-first-run --no-default-browser-check" +
                   " --autoplay-policy=no-user-gesture-required" +
                   " --disable-features=msImplicitSignin,msEdgeSidebarV2,msUndersideButton";
        try { Process.Start(new ProcessStartInfo(edge, a) { UseShellExecute = false }); }
        catch (Exception e) { MessageBox.Show("Не удалось запустить Microsoft Edge: " + e.Message, "YouPlay"); return; }

        if (Array.IndexOf(args, "--no-update") >= 0) return;
        try { CheckForUpdate(data); } catch { /* offline or GitHub unavailable: try next time */ }
    }

    static string FindEdge()
    {
        foreach (var hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
        {
            using (var k = hive.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"))
            {
                var p = k == null ? null : k.GetValue(null) as string;
                if (!string.IsNullOrEmpty(p) && File.Exists(p)) return p;
            }
        }
        foreach (var root in new[] { Environment.GetEnvironmentVariable("ProgramFiles(x86)"), Environment.GetEnvironmentVariable("ProgramFiles"),
                                     Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) })
        {
            if (string.IsNullOrEmpty(root)) continue;
            var p = Path.Combine(root, @"Microsoft\Edge\Application\msedge.exe");
            if (File.Exists(p)) return p;
        }
        return null;
    }

    static void CheckForUpdate(string data)
    {
        ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2
        using (var wc = new WebClient())
        {
            wc.Headers.Add("User-Agent", "YouPlay-Launcher");
            wc.Headers.Add("Accept", "application/vnd.github+json");
            string json = wc.DownloadString("https://api.github.com/repos/" + Repo + "/releases/latest");
            string tag = Regex.Match(json, "\"tag_name\"\\s*:\\s*\"v?([0-9]+(\\.[0-9]+){1,3})\"").Groups[1].Value;
            if (tag.Length == 0 || new Version(tag) <= new Version(Version)) return;
            string url = Regex.Match(json, "\"browser_download_url\"\\s*:\\s*\"(https://[^\"]*/YouPlay-Setup-[^\"]*\\.exe)\"").Groups[1].Value;
            if (url.Length == 0) return;

            string dl = Path.Combine(data, "Updates");
            Directory.CreateDirectory(dl);
            string file = Path.Combine(dl, "YouPlay-Setup-" + tag + ".exe");
            string tmp = file + ".part";
            wc.Headers.Clear();
            wc.Headers.Add("User-Agent", "YouPlay-Launcher");
            wc.DownloadFile(url, tmp);
            if (File.Exists(file)) File.Delete(file);
            File.Move(tmp, file);
            // silent install; the running window keeps playing, the new version opens next time
            Process.Start(new ProcessStartInfo(file, "/S /norun") { UseShellExecute = false });
        }
    }
}
