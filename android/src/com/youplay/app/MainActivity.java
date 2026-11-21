package com.youplay.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ContentUris;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Size;
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

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** YouPlay 2 for Android: YouPlay's own interface (inside the app, https://youplay.local/), a hidden
 *  YouTube Music window that plays music, a hidden SoundCloud window, music files on the phone,
 *  media notification, background playback and in-app updates. */
public class MainActivity extends Activity {
    static MainActivity current;
    static final String UI = "https://youplay.local/index.html";
    static final String YTM = "https://music.youtube.com/";
    static final String REPO = "delltrxxxx-hub/YouPlay";
    static final Pattern ADS = Pattern.compile("(^|\\.)(doubleclick\\.net|googlesyndication\\.com|googleadservices\\.com|imasdk\\.googleapis\\.com)$");
    static final Pattern AD_PATHS = Pattern.compile("youtube\\.com/(pagead/|api/stats/ads|ptracking|get_midroll_)");

    WebView ui, yt, sc;
    String engineJs = "", scJs = "";
    final Handler h = new Handler(Looper.getMainLooper());
    SharedPreferences prefs;
    boolean engineReady = false, adblock = true;
    final List<String> engineQueue = new ArrayList<>();
    final ArrayDeque<String[]> scJobs = new ArrayDeque<>();
    String scBusy = null;
    final Runnable scTimeout = () -> { if (scBusy != null) { toUi("{\"t\":\"scdata\",\"data\":{\"id\":" + JSONObject.quote(scBusy) + ",\"error\":\"timeout\"}}"); scBusy = null; scNext(); } };
    String updState = "idle", updTag = null, updUrl = null; int updPercent = 0; long updDownload = -1;
    boolean immersive = false;

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        current = this;
        prefs = getSharedPreferences("youplay", MODE_PRIVATE);
        engineJs = readAsset("engine.js");
        scJs = readAsset("sc.js");
        Window w = getWindow();
        w.setStatusBarColor(Color.rgb(18, 13, 11));
        w.setNavigationBarColor(Color.rgb(18, 13, 11));
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(18, 13, 11));
        sc = new WebView(this); yt = new WebView(this); ui = new WebView(this);
        for (WebView v : new WebView[]{sc, yt, ui}) root.addView(v, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        CookieManager.getInstance().setAcceptCookie(true);
        for (WebView v : new WebView[]{sc, yt, ui}) CookieManager.getInstance().setAcceptThirdPartyCookies(v, true);
        setupUi(); setupEngine(); setupSc();

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        ui.loadUrl(UI);
        yt.loadUrl(YTM);
        watchNetwork();
        h.postDelayed(() -> new Thread(this::checkUpdate).start(), 5000);
    }

    WebSettings base(WebView v) {
        WebSettings s = v.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); s.setSupportZoom(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        v.setBackgroundColor(Color.rgb(18, 13, 11));
        v.setWebChromeClient(new WebChromeClient());
        return s;
    }

    // ── the interface ──
    void setupUi() {
        base(ui);
        ui.addJavascriptInterface(new UiBridge(), "YouPlayNative");
        ui.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                if ("youplay.local".equals(r.getUrl().getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, r.getUrl())); } catch (Exception ignored) {}
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                if ("youplay.local".equals(r.getUrl().getHost())) return local(r.getUrl(), r.getRequestHeaders());
                return null;
            }
        });
    }
    void toUi(String json) { h.post(() -> ui.evaluateJavascript("window.__ypRecv && window.__ypRecv(" + json + ")", null)); }

    class UiBridge {
        @JavascriptInterface public void postHost(String raw) { h.post(() -> onUi(raw)); }
    }
    void onUi(String raw) {
        try {
            JSONObject m = new JSONObject(raw);
            String t = m.optString("t"), id = m.optString("id");
            switch (t) {
                case "eng": if (engineReady) yt.evaluateJavascript("window.__ypEng && window.__ypEng(" + raw + ")", null); else engineQueue.add(raw); break;
                case "sc": scJobs.add(new String[]{m.optString("op"), id, m.optString("arg")}); if (scBusy == null) scNext(); break;
                case "fetch": fetch(id, m.optString("url")); break;
                case "local": new Thread(() -> { String list = localJson(); toUi("{\"t\":\"local\",\"id\":" + JSONObject.quote(id) + "," + list + "}"); }).start(); break;
                case "perm-audio": requestPermissions(new String[]{Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_AUDIO : Manifest.permission.READ_EXTERNAL_STORAGE}, 2); break;
                case "login": if ("sc".equals(m.optString("service"))) scLogin(); else googleLogin(); break;
                case "logout": scLogout(); break;
                case "adblock": adblock = m.optBoolean("value", true); break;
                case "media": PlaybackService.update(this, raw); break;
                case "update": { String op = m.optString("op"); if ("now".equals(op)) updateNow(); else if ("check".equals(op)) { updState = "checking"; postUpdate(); new Thread(this::checkUpdate).start(); } else postUpdate(); break; }
                case "window": {
                    if ("fullscreen".equals(m.optString("op"))) toggleImmersive();
                    else if ("caption".equals(m.optString("op"))) { try { int c = Color.parseColor(m.optString("color")); getWindow().setStatusBarColor(c); getWindow().setNavigationBarColor(c); } catch (Exception ignored) {} }
                    break;
                }
                case "back-unhandled": moveTaskToBack(true); break;
            }
        } catch (Exception ignored) {}
    }
    @Override public void onRequestPermissionsResult(int code, String[] p, int[] r) { if (code == 2) ui.evaluateJavascript("window.__ypLocalReload && window.__ypLocalReload()", null); }

    // ── the engine: YouTube Music, never shown ──
    void setupEngine() {
        base(yt);
        yt.addJavascriptInterface(new EngineBridge(), "YouPlayNative");
        yt.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView v, String url, Bitmap b) { if (url.startsWith(YTM)) { engineReady = false; v.evaluateJavascript(engineJs, null); } }
            @Override public void onPageFinished(WebView v, String url) { if (url.startsWith(YTM)) v.evaluateJavascript(engineJs, null); CookieManager.getInstance().flush(); }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                String host = r.getUrl().getHost() == null ? "" : r.getUrl().getHost();
                if (host.matches("(.+\\.)?(youtube\\.com|google\\.com|google\\.[a-z.]+|gstatic\\.com|googleusercontent\\.com)")) {
                    if ((host.equals("www.youtube.com") || host.equals("youtube.com")) && ("/".equals(r.getUrl().getPath()) || r.getUrl().getPath() == null)) { v.loadUrl(YTM); return true; }
                    return false;
                }
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                if (!adblock) return null;
                Uri u = r.getUrl(); String host = u.getHost() == null ? "" : u.getHost();
                if (ADS.matcher(host).find() || AD_PATHS.matcher(host + u.getPath()).find()) return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
                return null;
            }
        });
    }
    class EngineBridge {
        @JavascriptInterface public void postHost(String raw) {
            if (!raw.startsWith("ui:")) return;
            final String json = raw.substring(3);
            h.post(() -> {
                if (json.contains("\"t\":\"engine-ready\"")) { engineReady = true; for (String q : engineQueue) yt.evaluateJavascript("window.__ypEng && window.__ypEng(" + q + ")", null); engineQueue.clear(); }
                toUi(json);
            });
        }
    }

    // ── SoundCloud helper page ──
    void setupSc() {
        base(sc);
        sc.addJavascriptInterface(new ScBridge(), "YouPlayNative");
        sc.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView v, String url, Bitmap b) { if (url.contains("soundcloud.com")) v.evaluateJavascript(scJs, null); }
            @Override public void onPageFinished(WebView v, String url) { if (url.contains("soundcloud.com")) v.evaluateJavascript(scJs, null); }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { String host = r.getUrl().getHost() == null ? "" : r.getUrl().getHost(); return !host.matches("(.+\\.)?(soundcloud\\.com|sndcdn\\.com)"); }
        });
    }
    class ScBridge {
        @JavascriptInterface public void postHost(String raw) {
            if (!raw.startsWith("scdata:")) return;
            final String data = raw.substring(7);
            h.post(() -> {
                toUi("{\"t\":\"scdata\",\"data\":" + data + "}");
                Matcher m = Pattern.compile("\"id\"\\s*:\\s*\"([A-Za-z0-9_-]+)\"").matcher(data);
                if (m.find() && m.group(1).equals(scBusy)) { h.removeCallbacks(scTimeout); scBusy = null; scNext(); }
            });
        }
    }
    void scNext() {
        if (scBusy != null || scJobs.isEmpty()) return;
        String[] j = scJobs.poll(); String op = j[0], id = j[1], arg = j[2], url;
        try {
            if (op.equals("search")) url = "https://soundcloud.com/search/sounds?q=" + java.net.URLEncoder.encode(arg, "UTF-8") + "&yp=" + id + "#yp=search:" + id;
            else if (op.equals("likes")) url = "https://soundcloud.com/you/likes?yp=" + id + "#yp=likes:" + id;
            else if (op.equals("status")) url = "https://soundcloud.com/you/library?yp=" + id + "#yp=status:" + id;
            else if ((op.equals("like") || op.equals("unlike")) && arg.matches("https://(www\\.|m\\.)?soundcloud\\.com/.+")) url = arg.split("#")[0] + (arg.contains("?") ? "&" : "?") + "yp=" + id + "#yp=" + op + ":" + id;
            else { toUi("{\"t\":\"scdata\",\"data\":{\"id\":" + JSONObject.quote(id) + ",\"error\":\"bad\"}}"); scNext(); return; }
        } catch (Exception e) { return; }
        scBusy = id; h.removeCallbacks(scTimeout); h.postDelayed(scTimeout, 30000);
        sc.loadUrl(url);
    }

    // ── sign-in dialogs ──
    void googleLogin() { loginDialog("https://accounts.google.com/ServiceLogin?service=youtube&continue=" + Uri.encode("https://www.youtube.com/signin?action_handle_signin=true&app=desktop&next=https%3A%2F%2Fmusic.youtube.com%2F"), "google"); }
    void scLogin() { loginDialog("https://soundcloud.com/signin", "sc"); }
    void loginDialog(String url, String service) {
        final WebView w = new WebView(this);
        base(w);
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, true);
        final AlertDialog d = new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_NoActionBar).setView(w).create();
        final boolean[] ok = {false};
        w.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView v, String u) {
                if ("google".equals(service) && u.startsWith(YTM)) { ok[0] = true; d.dismiss(); }
                if ("sc".equals(service)) { String ck = CookieManager.getInstance().getCookie("https://soundcloud.com"); if (u.startsWith("https://soundcloud.com/") && !u.contains("/signin") && ck != null && ck.contains("oauth_token=")) { ok[0] = true; d.dismiss(); } }
            }
        });
        d.setOnDismissListener(x -> {
            CookieManager.getInstance().flush();
            if (ok[0] && "google".equals(service)) { engineReady = false; yt.loadUrl(YTM); }
            toUi("{\"t\":\"login\",\"service\":\"" + service + "\",\"ok\":" + ok[0] + "}");
        });
        d.show();
        w.loadUrl(url);
    }
    void scLogout() {
        CookieManager cm = CookieManager.getInstance();
        for (String host : new String[]{"https://soundcloud.com", "https://secure.soundcloud.com", "https://api-v2.soundcloud.com", "https://api-auth.soundcloud.com"}) {
            String all = cm.getCookie(host); if (all == null) continue;
            for (String part : all.split(";")) { String n = part.split("=")[0].trim(); if (n.isEmpty()) continue; cm.setCookie(host, n + "=; Max-Age=0; Path=/"); cm.setCookie(host, n + "=; Max-Age=0; Path=/; Domain=.soundcloud.com"); }
        }
        cm.flush();
    }

    // ── HTTP helper (lyrics, SoundCloud links, GitHub) ──
    void fetch(String id, String url) {
        new Thread(() -> {
            String res;
            try {
                if (!url.matches("https://(lrclib\\.net|soundcloud\\.com|api\\.github\\.com)/.*")) throw new Exception("blocked");
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setRequestProperty("User-Agent", "YouPlay-Android/" + BuildConfig.VERSION); c.setConnectTimeout(12000); c.setReadTimeout(20000);
                int code = c.getResponseCode();
                InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                if (in != null) { byte[] b = new byte[16384]; int n; while ((n = in.read(b)) > 0) out.write(b, 0, n); }
                res = "{\"t\":\"fetch\",\"id\":" + JSONObject.quote(id) + ",\"status\":" + code + ",\"body\":" + JSONObject.quote(out.toString("UTF-8")) + "}";
            } catch (Exception e) { res = "{\"t\":\"fetch\",\"id\":" + JSONObject.quote(id) + ",\"status\":0,\"body\":\"\"}"; }
            toUi(res);
        }).start();
    }

    // ── music on the phone ──
    boolean audioAllowed() { return checkSelfPermission(Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_AUDIO : Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED; }
    String localJson() {
        if (!audioAllowed()) return "\"perm\":false";
        JSONArray arr = new JSONArray();
        String[] cols = {MediaStore.Audio.Media._ID, MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.ARTIST, MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.DURATION, MediaStore.Audio.Media.ALBUM_ID};
        try (Cursor c = getContentResolver().query(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, cols, MediaStore.Audio.Media.IS_MUSIC + "!=0", null, null)) {
            while (c != null && c.moveToNext()) {
                JSONObject o = new JSONObject();
                String id = String.valueOf(c.getLong(0)), artist = c.getString(2);
                o.put("id", id);
                o.put("title", c.getString(1) == null ? "Без названия" : c.getString(1));
                o.put("artist", artist == null || artist.equals("<unknown>") ? "Неизвестный исполнитель" : artist);
                o.put("album", c.getString(3) == null ? "" : c.getString(3));
                o.put("duration", c.getLong(4));
                o.put("url", "https://youplay.local/media/" + id);
                o.put("art", "https://youplay.local/art/" + c.getLong(5));
                arr.put(o);
            }
        } catch (Exception ignored) {}
        return "\"tracks\":" + arr;
    }
    WebResourceResponse local(Uri u, Map<String, String> headers) {
        String path = u.getPath() == null ? "/" : u.getPath();
        try {
            if (path.startsWith("/media/")) return media(Long.parseLong(path.substring(7)), headers);
            if (path.startsWith("/art/")) return art(Long.parseLong(path.substring(5)));
            if (path.equals("/") || path.isEmpty()) path = "/index.html";
            String name = "app" + path, mime = path.endsWith(".css") ? "text/css" : path.endsWith(".js") ? "application/javascript" : path.endsWith(".png") ? "image/png" : "text/html";
            Map<String, String> hd = new HashMap<>(); hd.put("Cache-Control", "no-cache");
            return new WebResourceResponse(mime, "utf-8", 200, "OK", hd, getAssets().open(name));
        } catch (Exception e) { return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, new ByteArrayInputStream(new byte[0])); }
    }
    WebResourceResponse media(long id, Map<String, String> headers) throws Exception {
        Uri uri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);
        String mime = getContentResolver().getType(uri);
        android.content.res.AssetFileDescriptor fd = getContentResolver().openAssetFileDescriptor(uri, "r");
        long size = fd.getLength();
        InputStream in = fd.createInputStream();
        String range = null;
        for (Map.Entry<String, String> e : headers.entrySet()) if (e.getKey().equalsIgnoreCase("Range")) range = e.getValue();
        Map<String, String> hd = new HashMap<>(); hd.put("Accept-Ranges", "bytes");
        Matcher m = range == null ? null : Pattern.compile("bytes=(\\d*)-(\\d*)").matcher(range);
        if (m != null && m.find() && size > 0) {
            long start = m.group(1).isEmpty() ? 0 : Long.parseLong(m.group(1));
            long end = m.group(2).isEmpty() ? size - 1 : Math.min(size - 1, Long.parseLong(m.group(2)));
            long sk = 0; while (sk < start) { long k = in.skip(start - sk); if (k <= 0) break; sk += k; }
            hd.put("Content-Range", "bytes " + start + "-" + end + "/" + size); hd.put("Content-Length", String.valueOf(end - start + 1));
            return new WebResourceResponse(mime == null ? "audio/mpeg" : mime, null, 206, "Partial Content", hd, in);
        }
        if (size > 0) hd.put("Content-Length", String.valueOf(size));
        return new WebResourceResponse(mime == null ? "audio/mpeg" : mime, null, 200, "OK", hd, in);
    }
    WebResourceResponse art(long albumId) throws Exception {
        Bitmap b = Build.VERSION.SDK_INT >= 29
            ? getContentResolver().loadThumbnail(ContentUris.withAppendedId(MediaStore.Audio.Albums.EXTERNAL_CONTENT_URI, albumId), new Size(512, 512), null)
            : android.graphics.BitmapFactory.decodeStream(getContentResolver().openInputStream(ContentUris.withAppendedId(Uri.parse("content://media/external/audio/albumart"), albumId)));
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.JPEG, 88, out);
        Map<String, String> hd = new HashMap<>(); hd.put("Cache-Control", "max-age=86400");
        return new WebResourceResponse("image/jpeg", null, 200, "OK", hd, new ByteArrayInputStream(out.toByteArray()));
    }

    // ── internet ──
    void watchNetwork() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            cm.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network n) { h.postDelayed(() -> { toUi("{\"t\":\"net\",\"online\":true}"); if (!engineReady) yt.reload(); }, 800); }
                @Override public void onLost(Network n) { h.post(() -> toUi("{\"t\":\"net\",\"online\":" + online() + "}")); }
            });
            if (!online()) h.postDelayed(() -> toUi("{\"t\":\"net\",\"online\":false}"), 1500);
        } catch (Exception ignored) {}
    }
    boolean online() {
        try { ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE); Network n = cm.getActiveNetwork(); NetworkCapabilities c = n == null ? null : cm.getNetworkCapabilities(n); return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET); }
        catch (Exception e) { return true; }
    }

    // ── updates (GitHub release with YouPlay-Android-<version>.apk) ──
    void checkUpdate() {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL("https://api.github.com/repos/" + REPO + "/releases/latest").openConnection();
            c.setRequestProperty("User-Agent", "YouPlay-Android"); c.setRequestProperty("Accept", "application/vnd.github+json");
            InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] b = new byte[16384]; int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
            String json = out.toString("UTF-8");
            Matcher t = Pattern.compile("\"tag_name\"\\s*:\\s*\"v?([0-9]+(\\.[0-9]+){1,3})\"").matcher(json);
            Matcher a = Pattern.compile("\"browser_download_url\"\\s*:\\s*\"(https://[^\"]*/YouPlay-Android-[^\"]*\\.apk)\"").matcher(json);
            if (t.find() && a.find() && newer(t.group(1), BuildConfig.VERSION)) { updTag = t.group(1); updUrl = a.group(1); updState = "available"; } else updState = "none";
        } catch (Exception e) { updState = "error"; }
        h.post(this::postUpdate);
    }
    static boolean newer(String a, String b) {
        String[] x = a.split("\\."), y = b.split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) { int p = i < x.length ? Integer.parseInt(x[i]) : 0, q = i < y.length ? Integer.parseInt(y[i]) : 0; if (p != q) return p > q; }
        return false;
    }
    void postUpdate() { toUi("{\"t\":\"update\",\"state\":" + JSONObject.quote(updState) + ",\"version\":" + JSONObject.quote(updTag == null ? "" : updTag) + ",\"current\":" + JSONObject.quote(BuildConfig.VERSION) + ",\"percent\":" + updPercent + "}"); }
    void updateNow() {
        if (!"available".equals(updState) || updUrl == null) { postUpdate(); return; }
        DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        updDownload = dm.enqueue(new DownloadManager.Request(Uri.parse(updUrl)).setTitle("YouPlay " + updTag).setMimeType("application/vnd.android.package-archive")
            .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, "YouPlay-" + updTag + ".apk").setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE));
        updState = "downloading"; updPercent = 0; postUpdate();
        final Runnable poll = new Runnable() { public void run() {
            try (Cursor cur = dm.query(new DownloadManager.Query().setFilterById(updDownload))) {
                if (cur != null && cur.moveToFirst()) {
                    int st = cur.getInt(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                    long done = cur.getLong(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)), total = cur.getLong(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                    if (total > 0) { updPercent = (int) (done * 100 / total); postUpdate(); }
                    if (st == DownloadManager.STATUS_SUCCESSFUL) { updState = "installing"; postUpdate(); startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(dm.getUriForDownloadedFile(updDownload), "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK)); return; }
                    if (st == DownloadManager.STATUS_FAILED) { updState = "error"; postUpdate(); return; }
                }
            } catch (Exception e) { updState = "error"; postUpdate(); return; }
            h.postDelayed(this, 500);
        }};
        h.postDelayed(poll, 500);
    }

    void toggleImmersive() { immersive = !immersive; getWindow().getDecorView().setSystemUiVisibility(immersive ? (View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY) : 0); }
    String readAsset(String n) {
        try (InputStream in = getAssets().open(n)) { ByteArrayOutputStream o = new ByteArrayOutputStream(); byte[] b = new byte[65536]; int k; while ((k = in.read(b)) > 0) o.write(b, 0, k); return o.toString("UTF-8"); }
        catch (Exception e) { return ""; }
    }
    /** Media notification / lock screen buttons. */
    static void media(String op) { MainActivity a = current; if (a != null) a.toUi("{\"t\":\"media-cmd\",\"op\":" + JSONObject.quote(op) + "}"); }

    @Override public void onBackPressed() { toUi("{\"t\":\"back\"}"); }
    @Override protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }
    @Override protected void onDestroy() { if (current == this) current = null; super.onDestroy(); }
}
