package com.youplay.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

import android.content.ContentUris;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.provider.MediaStore;
import android.util.Size;
import org.json.JSONArray;
import java.util.HashMap;
import java.util.Map;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayDeque;
import java.util.Iterator;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** YouPlay for Android: YouTube Music in a WebView with the YouPlay interface injected, a hidden
 *  soundcloud.com WebView for SoundCloud search/likes, media notification and in-app updates. */
public class MainActivity extends Activity {
    static MainActivity current;
    static final String YTM = "https://music.youtube.com/";
    static final String REPO = "delltrxxxx-hub/YouPlay";
    static final String OFFLINE = "https://youplay.local/";

    WebView web, sc;
    String bundle = "", scBundle = "";
    final Handler ui = new Handler(Looper.getMainLooper());
    SharedPreferences prefs;
    final ArrayDeque<String[]> scJobs = new ArrayDeque<>();
    String scBusy = null;
    final Runnable scTimeout = () -> { if (scBusy != null) { postToYt("{\"ypScData\":{\"id\":" + JSONObject.quote(scBusy) + ",\"error\":\"timeout\"}}"); scBusy = null; scNext(); } };
    String updState = "idle", updTag = null, updUrl = null; int updPercent = 0; long updDownload = -1;
    boolean immersive = false;

    static final Pattern ADS = Pattern.compile("(^|\\.)(doubleclick\\.net|googlesyndication\\.com|googleadservices\\.com|imasdk\\.googleapis\\.com)$");
    static final Pattern AD_PATHS = Pattern.compile("youtube\\.com/(pagead/|api/stats/ads|ptracking|get_midroll_)");

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        current = this;
        prefs = getSharedPreferences("youplay", MODE_PRIVATE);
        bundle = readAsset("youplay.js");
        scBundle = readAsset("sc.js");

        Window w = getWindow();
        w.setStatusBarColor(Color.rgb(18, 13, 11));
        w.setNavigationBarColor(Color.rgb(18, 13, 11));
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(18, 13, 11));
        sc = new WebView(this);
        web = new WebView(this);
        root.addView(sc, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(sc, true);
        setup(web, true);
        setup(sc, false);
        sc.setVisibility(View.INVISIBLE);

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);

        if (saved != null) web.restoreState(saved); else web.loadUrl(online() ? YTM : OFFLINE);
        watchNetwork();
        ui.postDelayed(() -> new Thread(this::checkUpdate).start(), 4000);
    }

    void setup(WebView v, boolean main) {
        WebSettings s = v.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        v.setBackgroundColor(Color.rgb(18, 13, 11));
        v.addJavascriptInterface(new Bridge(main), "YouPlayNative");
        v.setWebChromeClient(new WebChromeClient());
        v.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (main && url.startsWith(YTM)) view.evaluateJavascript(bundle, null);
                if (!main && url.contains("soundcloud.com")) view.evaluateJavascript(scBundle, null);
            }
            @Override public void onPageFinished(WebView view, String url) {
                // safety net: inject again if the page started too early (the bundle guards against running twice)
                if (main && url.startsWith(YTM)) view.evaluateJavascript(bundle, null);
                if (!main && url.contains("soundcloud.com")) view.evaluateJavascript(scBundle, null);
                CookieManager.getInstance().flush();
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                String h = u.getHost() == null ? "" : u.getHost().toLowerCase();
                if (main && h.equals("youplay.local")) return false;
                boolean inside = main ? h.matches("(.+\\.)?(youtube\\.com|google\\.com|google\\.[a-z.]+|gstatic\\.com|googleusercontent\\.com)")
                                      : h.matches("(.+\\.)?(soundcloud\\.com|sndcdn\\.com)");
                if (inside) {
                    if (main && (h.equals("www.youtube.com") || h.equals("youtube.com")) && (u.getPath() == null || u.getPath().equals("/") || u.getPath().startsWith("/feed"))) { view.loadUrl(YTM); return true; }
                    return false;
                }
                if (main) { try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {} }
                return true;
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest req, android.webkit.WebResourceError err) {
                if (main && req.isForMainFrame() && req.getUrl().toString().startsWith("https://music.youtube.com")) view.loadUrl(OFFLINE);
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("youplay.local".equals(u.getHost())) return local(u, req.getRequestHeaders());
                if (!adblock()) return null;
                String h = u.getHost() == null ? "" : u.getHost();
                if (ADS.matcher(h).find() || AD_PATHS.matcher(h + u.getPath()).find())
                    return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
                return null;
            }
        });
    }

    boolean adblock() {
        try { return new JSONObject(prefs.getString("store", "{}")).optBoolean("adblock", true); } catch (Exception e) { return true; }
    }

    String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] b = new byte[65536]; int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
            return out.toString("UTF-8");
        } catch (Exception e) { return ""; }
    }

    void postToYt(String json) {
        ui.post(() -> web.evaluateJavascript("window.postMessage(" + json + ", '*');", null));
    }

    /** Called by the media notification / lock screen. */
    static void media(String action) {
        MainActivity a = current;
        if (a != null) a.postToYt("{\"ypMedia\":" + JSONObject.quote(action) + "}");
    }

    // ───────── JavaScript bridge ─────────
    class Bridge {
        final boolean main;
        Bridge(boolean main) { this.main = main; }

        @JavascriptInterface public String version() { return BuildConfig.VERSION; }
        @JavascriptInterface public String storageGetAll() { return prefs.getString("store", "{}"); }
        @JavascriptInterface public void storageSet(String json) {
            synchronized (prefs) {
                try {
                    JSONObject cur = new JSONObject(prefs.getString("store", "{}"));
                    JSONObject add = new JSONObject(json);
                    for (Iterator<String> it = add.keys(); it.hasNext(); ) { String k = it.next(); cur.put(k, add.get(k)); }
                    prefs.edit().putString("store", cur.toString()).apply();
                } catch (Exception ignored) {}
            }
        }
        @JavascriptInterface public void storageRemove(String key) {
            synchronized (prefs) {
                try { JSONObject cur = new JSONObject(prefs.getString("store", "{}")); cur.remove(key); prefs.edit().putString("store", cur.toString()).apply(); } catch (Exception ignored) {}
            }
        }
        /** GET for lyrics (LRCLIB), SoundCloud oEmbed and GitHub — only these hosts. */
        @JavascriptInterface public void fetch(String id, String url) {
            new Thread(() -> {
                String res;
                try {
                    if (!url.matches("https://(lrclib\\.net|soundcloud\\.com|api\\.github\\.com)/.*")) throw new Exception("blocked");
                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    c.setRequestProperty("User-Agent", "YouPlay-Android/" + BuildConfig.VERSION);
                    c.setConnectTimeout(12000); c.setReadTimeout(20000);
                    int code = c.getResponseCode();
                    InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    if (in != null) { byte[] b = new byte[16384]; int n; while ((n = in.read(b)) > 0) out.write(b, 0, n); }
                    res = "{\"status\":" + code + ",\"body\":" + JSONObject.quote(out.toString("UTF-8")) + "}";
                } catch (Exception e) { res = "{\"status\":0,\"body\":\"\"}"; }
                final String r = res;
                ui.post(() -> (main ? web : sc).evaluateJavascript("window.__ypNativeResolve && window.__ypNativeResolve(" + JSONObject.quote(id) + "," + r + ")", null));
            }).start();
        }
        @JavascriptInterface public void postHost(String msg) { ui.post(() -> onHost(msg, main)); }
    }

    void onHost(String msg, boolean fromMain) {
        if (msg.startsWith("scdata:")) {
            String json = msg.substring(7);
            postToYt("{\"ypScData\":" + json + "}");
            Matcher m = Pattern.compile("\"id\"\\s*:\\s*\"([A-Za-z0-9_-]+)\"").matcher(json);
            if (m.find() && m.group(1).equals(scBusy)) { ui.removeCallbacks(scTimeout); scBusy = null; scNext(); }
            return;
        }
        if (!fromMain) return;
        if (msg.startsWith("media:")) { PlaybackService.update(this, msg.substring(6)); return; }
        if (msg.startsWith("caption:#")) {
            try { int c = Color.parseColor(msg.substring(8)); getWindow().setStatusBarColor(c); getWindow().setNavigationBarColor(c); } catch (Exception ignored) {}
            return;
        }
        if (msg.equals("fullscreen")) { toggleImmersive(); return; }
        Matcher j = Pattern.compile("^sc:(search|likes|like|unlike|status):([A-Za-z0-9_-]{1,40}):(.*)$", Pattern.DOTALL).matcher(msg);
        if (j.find()) { scJobs.add(new String[]{j.group(1), j.group(2), j.group(3)}); if (scBusy == null) scNext(); return; }
        if (msg.equals("sclogin")) { scLogin(); return; }
        if (msg.equals("sclogout")) { scLogout(); return; }
        if (msg.equals("update-status")) { postUpdate(); return; }
        if (msg.equals("update-check")) { updState = "checking"; postUpdate(); new Thread(this::checkUpdate).start(); return; }
        if (msg.equals("update-now")) { updateNow(); return; }
        if (msg.equals("localmusic")) { web.loadUrl(OFFLINE); return; }
        if (msg.equals("go-online")) { if (online()) web.loadUrl(YTM); else web.evaluateJavascript("window.__ypNet && window.__ypNet(false)", null); return; }
        if (msg.equals("perm-audio")) {
            String p = Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_AUDIO : Manifest.permission.READ_EXTERNAL_STORAGE;
            requestPermissions(new String[]{p}, 2);
        }
    }

    @Override public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        if (code == 2) web.evaluateJavascript("window.__ypReload && window.__ypReload()", null);
    }

    boolean audioAllowed() {
        String p = Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_AUDIO : Manifest.permission.READ_EXTERNAL_STORAGE;
        return checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED;
    }

    // ───────── internet ─────────
    boolean online() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            Network n = cm.getActiveNetwork();
            NetworkCapabilities c = n == null ? null : cm.getNetworkCapabilities(n);
            return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Exception e) { return true; }
    }
    void watchNetwork() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            cm.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network n) { ui.postDelayed(() -> netChanged(true), 800); }
                @Override public void onLost(Network n) { ui.post(() -> netChanged(online())); }
            });
        } catch (Exception ignored) {}
    }
    void netChanged(boolean on) {
        String url = web.getUrl();
        if (url != null && url.startsWith(OFFLINE)) web.evaluateJavascript("window.__ypNet && window.__ypNet(" + on + ")", null);
    }

    // ───────── local server for the offline player: https://youplay.local/... ─────────
    WebResourceResponse local(Uri u, Map<String, String> reqHeaders) {
        String path = u.getPath() == null ? "/" : u.getPath();
        try {
            if (path.equals("/") || path.equals("/index.html")) return asset("offline/index.html", "text/html");
            if (path.equals("/offline.css")) return asset("offline/offline.css", "text/css");
            if (path.equals("/offline.js")) return asset("offline/offline.js", "application/javascript");
            if (path.equals("/api/tracks")) return text(tracksJson(), "application/json");
            if (path.startsWith("/media/")) return media(Long.parseLong(path.substring(7)), reqHeaders);
            if (path.startsWith("/art/")) return art(Long.parseLong(path.substring(5)));
        } catch (Exception ignored) {}
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, new ByteArrayInputStream(new byte[0]));
    }
    WebResourceResponse asset(String name, String mime) throws Exception {
        return new WebResourceResponse(mime, "utf-8", getAssets().open(name));
    }
    WebResourceResponse text(String body, String mime) {
        Map<String, String> h = new HashMap<>(); h.put("Cache-Control", "no-store");
        return new WebResourceResponse(mime, "utf-8", 200, "OK", h, new ByteArrayInputStream(body.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    }
    String tracksJson() {
        if (!audioAllowed()) return "{\"perm\":false}";
        JSONArray arr = new JSONArray();
        String[] cols = {MediaStore.Audio.Media._ID, MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.ARTIST, MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.DURATION, MediaStore.Audio.Media.ALBUM_ID};
        try (Cursor c = getContentResolver().query(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, cols, MediaStore.Audio.Media.IS_MUSIC + "!=0", null, null)) {
            while (c != null && c.moveToNext()) {
                JSONObject o = new JSONObject();
                o.put("id", String.valueOf(c.getLong(0)));
                o.put("title", c.getString(1) == null ? "Без названия" : c.getString(1));
                String artist = c.getString(2);
                o.put("artist", artist == null || artist.equals("<unknown>") ? "Неизвестный исполнитель" : artist);
                o.put("album", c.getString(3) == null ? "" : c.getString(3));
                o.put("duration", c.getLong(4));
                o.put("albumId", String.valueOf(c.getLong(5)));
                arr.put(o);
            }
        } catch (Exception ignored) {}
        return "{\"tracks\":" + arr + "}";
    }
    /** Streams a phone audio file with HTTP range support (so seeking works). */
    WebResourceResponse media(long id, Map<String, String> reqHeaders) throws Exception {
        Uri uri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);
        String mime = getContentResolver().getType(uri);
        android.content.res.AssetFileDescriptor fd = getContentResolver().openAssetFileDescriptor(uri, "r");
        long size = fd.getLength();
        InputStream in = fd.createInputStream();
        String range = null;
        for (Map.Entry<String, String> e : reqHeaders.entrySet()) if (e.getKey().equalsIgnoreCase("Range")) range = e.getValue();
        Map<String, String> h = new HashMap<>();
        h.put("Accept-Ranges", "bytes");
        Matcher m = range == null ? null : Pattern.compile("bytes=(\\d*)-(\\d*)").matcher(range);
        if (m != null && m.find() && size > 0) {
            long start = m.group(1).isEmpty() ? 0 : Long.parseLong(m.group(1));
            long end = m.group(2).isEmpty() ? size - 1 : Math.min(size - 1, Long.parseLong(m.group(2)));
            long skipped = 0; while (skipped < start) { long k = in.skip(start - skipped); if (k <= 0) break; skipped += k; }
            h.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
            h.put("Content-Length", String.valueOf(end - start + 1));
            return new WebResourceResponse(mime == null ? "audio/mpeg" : mime, null, 206, "Partial Content", h, in);
        }
        if (size > 0) h.put("Content-Length", String.valueOf(size));
        return new WebResourceResponse(mime == null ? "audio/mpeg" : mime, null, 200, "OK", h, in);
    }
    WebResourceResponse art(long albumId) throws Exception {
        Bitmap b;
        if (Build.VERSION.SDK_INT >= 29) b = getContentResolver().loadThumbnail(ContentUris.withAppendedId(MediaStore.Audio.Albums.EXTERNAL_CONTENT_URI, albumId), new Size(512, 512), null);
        else b = BitmapFactory_decode(getContentResolver().openInputStream(ContentUris.withAppendedId(Uri.parse("content://media/external/audio/albumart"), albumId)));
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.JPEG, 88, out);
        Map<String, String> h = new HashMap<>(); h.put("Cache-Control", "max-age=86400");
        return new WebResourceResponse("image/jpeg", null, 200, "OK", h, new ByteArrayInputStream(out.toByteArray()));
    }
    static Bitmap BitmapFactory_decode(InputStream in) { return android.graphics.BitmapFactory.decodeStream(in); }

    void toggleImmersive() {
        immersive = !immersive;
        View d = getWindow().getDecorView();
        d.setSystemUiVisibility(immersive ? (View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY) : 0);
    }

    // ───────── hidden SoundCloud page ─────────
    void scNext() {
        if (scBusy != null || scJobs.isEmpty()) return;
        String[] job = scJobs.poll();
        String op = job[0], id = job[1], arg = job[2], url;
        try {
            if (op.equals("search")) url = "https://soundcloud.com/search/sounds?q=" + java.net.URLEncoder.encode(arg, "UTF-8") + "&yp=" + id + "#yp=search:" + id;
            else if (op.equals("likes")) url = "https://soundcloud.com/you/likes?yp=" + id + "#yp=likes:" + id;
            else if (op.equals("status")) url = "https://soundcloud.com/you/library?yp=" + id + "#yp=status:" + id;
            else if (arg.matches("https://(www\\.|m\\.)?soundcloud\\.com/.+")) url = arg.split("#")[0] + (arg.contains("?") ? "&" : "?") + "yp=" + id + "#yp=" + op + ":" + id;
            else { postToYt("{\"ypScData\":{\"id\":" + JSONObject.quote(id) + ",\"error\":\"bad\"}}"); scNext(); return; }
        } catch (Exception e) { return; }
        scBusy = id;
        ui.removeCallbacks(scTimeout);
        ui.postDelayed(scTimeout, 30000);
        sc.loadUrl(url);
    }

    void scLogin() {
        final WebView w = new WebView(this);
        setup(w, false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, true);
        final AlertDialog d = new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_NoActionBar).setView(w).create();
        w.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                String ck = CookieManager.getInstance().getCookie("https://soundcloud.com");
                if (url.startsWith("https://soundcloud.com/") && !url.contains("/signin") && ck != null && ck.contains("oauth_token=")) {
                    CookieManager.getInstance().flush();
                    d.dismiss();
                    postToYt("{\"ypScLogin\":true}");
                }
            }
        });
        d.setOnCancelListener(x -> postToYt("{\"ypScLogin\":false}"));
        d.show();
        w.loadUrl("https://soundcloud.com/signin");
    }

    void scLogout() {
        CookieManager cm = CookieManager.getInstance();
        for (String host : new String[]{"https://soundcloud.com", "https://secure.soundcloud.com", "https://api-v2.soundcloud.com", "https://api-auth.soundcloud.com"}) {
            String all = cm.getCookie(host);
            if (all == null) continue;
            for (String part : all.split(";")) {
                String name = part.split("=")[0].trim();
                if (name.isEmpty()) continue;
                cm.setCookie(host, name + "=; Max-Age=0; Path=/");
                cm.setCookie(host, name + "=; Max-Age=0; Path=/; Domain=.soundcloud.com");
            }
        }
        cm.flush();
        postToYt("{\"ypScLogout\":true}");
    }

    // ───────── updates: GitHub release with YouPlay-Android-<version>.apk ─────────
    void checkUpdate() {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL("https://api.github.com/repos/" + REPO + "/releases/latest").openConnection();
            c.setRequestProperty("User-Agent", "YouPlay-Android");
            c.setRequestProperty("Accept", "application/vnd.github+json");
            InputStream in = c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] b = new byte[16384]; int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
            String json = out.toString("UTF-8");
            Matcher t = Pattern.compile("\"tag_name\"\\s*:\\s*\"v?([0-9]+(\\.[0-9]+){1,3})\"").matcher(json);
            Matcher a = Pattern.compile("\"browser_download_url\"\\s*:\\s*\"(https://[^\"]*/YouPlay-Android-[^\"]*\\.apk)\"").matcher(json);
            if (t.find() && a.find() && newer(t.group(1), BuildConfig.VERSION)) { updTag = t.group(1); updUrl = a.group(1); updState = "available"; }
            else updState = "none";
        } catch (Exception e) { updState = "error"; }
        ui.post(this::postUpdate);
    }
    static boolean newer(String a, String b) {
        String[] x = a.split("\\."), y = b.split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? Integer.parseInt(x[i]) : 0, q = i < y.length ? Integer.parseInt(y[i]) : 0;
            if (p != q) return p > q;
        }
        return false;
    }
    void postUpdate() {
        postToYt("{\"ypUpdate\":{\"state\":" + JSONObject.quote(updState) + ",\"version\":" + JSONObject.quote(updTag == null ? "" : updTag) + ",\"current\":" + JSONObject.quote(BuildConfig.VERSION) + ",\"percent\":" + updPercent + "}}");
    }
    void updateNow() {
        if (!"available".equals(updState) || updUrl == null) { postUpdate(); return; }
        DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        DownloadManager.Request r = new DownloadManager.Request(Uri.parse(updUrl))
            .setTitle("YouPlay " + updTag).setMimeType("application/vnd.android.package-archive")
            .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, "YouPlay-" + updTag + ".apk")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
        updDownload = dm.enqueue(r);
        updState = "downloading"; updPercent = 0; postUpdate();
        final Runnable poll = new Runnable() { public void run() {
            DownloadManager.Query q = new DownloadManager.Query().setFilterById(updDownload);
            try (android.database.Cursor cur = dm.query(q)) {
                if (cur != null && cur.moveToFirst()) {
                    int st = cur.getInt(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                    long done = cur.getLong(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                    long total = cur.getLong(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                    if (total > 0) { updPercent = (int) (done * 100 / total); postUpdate(); }
                    if (st == DownloadManager.STATUS_SUCCESSFUL) {
                        updState = "installing"; postUpdate();
                        Uri apk = dm.getUriForDownloadedFile(updDownload);
                        Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(apk, "application/vnd.android.package-archive")
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                        return;
                    }
                    if (st == DownloadManager.STATUS_FAILED) { updState = "error"; postUpdate(); return; }
                }
            } catch (Exception e) { updState = "error"; postUpdate(); return; }
            ui.postDelayed(this, 500);
        }};
        ui.postDelayed(poll, 500);
    }

    // ───────── lifecycle ─────────
    @Override public void onBackPressed() {
        web.evaluateJavascript("(window.__ypBack && window.__ypBack()) ? 'y' : 'n'", r -> {
            if (r != null && r.contains("y")) return;
            if (web.canGoBack()) web.goBack(); else moveTaskToBack(true);   // keep playing in the background
        });
    }
    @Override protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }   // the WebView keeps playing
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override protected void onDestroy() { if (current == this) current = null; super.onDestroy(); }
}
