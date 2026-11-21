package com.youplay.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
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

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Hidden helpers that never show on screen: the YouTube Music page (search, home, likes, playback),
 *  the SoundCloud page (search, likes, playlists) and the SoundCloud player widget. */
final class Engine {
    interface Cb { void on(JSONObject o); }
    interface Listener { void onState(JSONObject s); void onEnded(String videoId); void onReady(JSONObject account); void onSc(JSONObject ev); }

    static final String YTM = "https://music.youtube.com/";
    static final Pattern ADS = Pattern.compile("(^|\\.)(doubleclick\\.net|googlesyndication\\.com|googleadservices\\.com|imasdk\\.googleapis\\.com)$");
    static final Pattern AD_PATHS = Pattern.compile("youtube\\.com/(pagead/|api/stats/ads|ptracking|get_midroll_)");

    final Context ctx; final Listener listener;
    WebView yt, sc, scp;
    String engineJs, scJs;
    boolean ready = false, adblock = true;
    JSONObject account = new JSONObject();
    final List<String> queue = new ArrayList<>();
    final Map<String, Cb> waiting = new HashMap<>();
    final ArrayDeque<String[]> scJobs = new ArrayDeque<>();
    String scBusy = null;
    int seq = 0;
    final Runnable scTimeout = new Runnable() { public void run() { if (scBusy != null) { reply(scBusy, err("timeout")); scBusy = null; scNext(); } } };

    Engine(Context ctx, FrameLayout host, String engineJs, String scJs, Listener l) {
        this.ctx = ctx; this.engineJs = engineJs; this.scJs = scJs; this.listener = l;
        int w = Ui.dp(1100), h = Ui.dp(800);
        sc = new WebView(ctx); yt = new WebView(ctx); scp = new WebView(ctx);
        for (WebView v : new WebView[]{sc, yt, scp}) { host.addView(v, 0, new FrameLayout.LayoutParams(w, h)); setup(v); CookieManager.getInstance().setAcceptThirdPartyCookies(v, true); }
        setupYt(); setupSc(); setupScp();
        yt.loadUrl(YTM);
    }
    String id() { return "n" + (++seq); }
    static JSONObject err(String e) { JSONObject o = new JSONObject(); try { o.put("error", e); } catch (Exception ignored) {} return o; }
    void reply(String id, JSONObject data) { Cb cb = waiting.remove(id); if (cb != null) cb.on(data == null ? new JSONObject() : data); }

    @SuppressLint("SetJavaScriptEnabled")
    static void setup(WebView v) {
        WebSettings s = v.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        v.setBackgroundColor(Color.BLACK);
        v.setWebChromeClient(new WebChromeClient());
    }

    // ── YouTube Music ──
    void setupYt() {
        yt.addJavascriptInterface(new Object() {
            @JavascriptInterface public void postHost(String raw) {
                if (!raw.startsWith("ui:")) return;
                final String json = raw.substring(3);
                Ui.main.post(() -> onYt(json));
            }
        }, "YouPlayNative");
        yt.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView v, String url, Bitmap b) { if (url.startsWith(YTM)) { ready = false; v.evaluateJavascript(engineJs, null); } }
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
    void onYt(String json) {
        try {
            JSONObject m = new JSONObject(json);
            String t = m.optString("t");
            if ("eng".equals(t)) { reply(m.optString("id"), m.optJSONObject("data")); return; }
            if ("state".equals(t)) { listener.onState(m); return; }
            if ("ended".equals(t)) { listener.onEnded(m.optString("videoId")); return; }
            if ("engine-ready".equals(t)) {
                ready = true; account = m.optJSONObject("account") == null ? new JSONObject() : m.optJSONObject("account");
                for (String q : queue) yt.evaluateJavascript("window.__ypEng && window.__ypEng(" + q + ")", null);
                queue.clear();
                listener.onReady(account);
            }
        } catch (Exception ignored) {}
    }
    /** Ask the YouTube Music engine: cmd = home, search, browse, likes, account, playlists, plAdd, plCreate, lyrics, play, control. */
    void eng(JSONObject cmd, Cb cb) {
        try {
            String id = id(); cmd.put("t", "eng"); cmd.put("id", id);
            if (cb != null) {
                waiting.put(id, cb);
                final String fid = id;
                Ui.main.postDelayed(() -> reply(fid, err("timeout")), 60000);
            }
            String raw = cmd.toString();
            if (ready) yt.evaluateJavascript("window.__ypEng && window.__ypEng(" + raw + ")", null); else queue.add(raw);
        } catch (Exception ignored) {}
    }
    void eng(String cmd, Cb cb, Object... kv) {
        JSONObject o = new JSONObject();
        try { o.put("cmd", cmd); for (int i = 0; i + 1 < kv.length; i += 2) o.put((String) kv[i], kv[i + 1]); } catch (Exception ignored) {}
        eng(o, cb);
    }
    void control(String op, Object... kv) { Object[] all = new Object[kv.length + 2]; all[0] = "op"; all[1] = op; System.arraycopy(kv, 0, all, 2, kv.length); eng("control", null, all); }

    // ── SoundCloud pages (search, likes, playlists, like / add) ──
    void setupSc() {
        sc.addJavascriptInterface(new Object() {
            @JavascriptInterface public void postHost(String raw) {
                if (!raw.startsWith("scdata:")) return;
                final String data = raw.substring(7);
                Ui.main.post(() -> {
                    try {
                        JSONObject d = new JSONObject(data);
                        String id = d.optString("id");
                        reply(id, d);
                        if (id.equals(scBusy)) { Ui.main.removeCallbacks(scTimeout); scBusy = null; scNext(); }
                    } catch (Exception ignored) {}
                });
            }
        }, "YouPlayNative");
        sc.getSettings().setMediaPlaybackRequiresUserGesture(true);
        sc.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView v, String url, Bitmap b) { if (url.contains("soundcloud.com")) v.evaluateJavascript(scJs, null); }
            @Override public void onPageFinished(WebView v, String url) { if (url.contains("soundcloud.com")) v.evaluateJavascript(scJs, null); }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { String host = r.getUrl().getHost() == null ? "" : r.getUrl().getHost(); return !host.matches("(.+\\.)?(soundcloud\\.com|sndcdn\\.com)"); }
        });
    }
    /** op = search | likes | status | sets | set | like | unlike | addto | create; arg = query or track/playlist url (+ "#name=" for addto / create). */
    void sc(String op, String arg, Cb cb) {
        String id = id();
        if (cb != null) waiting.put(id, cb);
        scJobs.add(new String[]{op, id, arg == null ? "" : arg});
        if (scBusy == null) scNext();
    }
    void scNext() {
        if (scBusy != null || scJobs.isEmpty()) return;
        String[] j = scJobs.poll(); String op = j[0], id = j[1], arg = j[2], url = null;
        try {
            boolean scUrl = arg.matches("https://(www\\.|m\\.)?soundcloud\\.com/.+");
            if (op.equals("search")) url = "https://soundcloud.com/search/sounds?q=" + URLEncoder.encode(arg, "UTF-8") + "&yp=" + id + "#yp=search:" + id;
            else if (op.equals("likes")) url = "https://soundcloud.com/you/likes?yp=" + id + "#yp=likes:" + id;
            else if (op.equals("status")) url = "https://soundcloud.com/you/library?yp=" + id + "#yp=status:" + id;
            else if (op.equals("sets")) url = "https://soundcloud.com/you/sets?yp=" + id + "#yp=sets:" + id;
            else if (scUrl && (op.equals("set") || op.equals("like") || op.equals("unlike"))) url = arg.split("#")[0] + (arg.contains("?") ? "&" : "?") + "yp=" + id + "#yp=" + op + ":" + id;
            else if (scUrl && (op.equals("addto") || op.equals("create"))) {
                int k = arg.indexOf("#name="); String name = k >= 0 ? arg.substring(k + 6) : "", track = k >= 0 ? arg.substring(0, k) : arg;
                url = track + (track.contains("?") ? "&" : "?") + "yp=" + id + "#yp=" + op + ":" + id + ":" + name;
            }
        } catch (Exception ignored) {}
        if (url == null) { reply(id, err("bad")); scNext(); return; }
        scBusy = id; Ui.main.removeCallbacks(scTimeout); Ui.main.postDelayed(scTimeout, 40000);
        sc.loadUrl(url);
    }

    // ── SoundCloud player (official widget inside a tiny page) ──
    void setupScp() {
        scp.addJavascriptInterface(new Object() {
            @JavascriptInterface public void postHost(String raw) {
                if (!raw.startsWith("scp:")) return;
                final String json = raw.substring(4);
                Ui.main.post(() -> { try { listener.onSc(new JSONObject(json)); } catch (Exception ignored) {} });
            }
        }, "YouPlayNative");
        scp.setWebViewClient(new WebViewClient());
        String html = "<!doctype html><html><body style='margin:0;background:#000'><iframe id='f' allow='autoplay' style='width:400px;height:160px;border:0'></iframe><script>"
            + "var f=document.getElementById('f'),O='https://w.soundcloud.com',ready=false,vol=100;"
            + "function post(m,v){if(ready&&f.contentWindow)f.contentWindow.postMessage(JSON.stringify(v===undefined?{method:m}:{method:m,value:v}),O);}"
            + "function send(o){YouPlayNative.postHost('scp:'+JSON.stringify(o));}"
            + "window.load=function(u){ready=false;f.src=O+'/player/?url='+encodeURIComponent(u)+'&auto_play=true&visual=false&show_artwork=false&show_comments=false&buying=false&sharing=false&download=false';};"
            + "window.cmd=function(m,v){post(m,v);};"
            + "addEventListener('message',function(e){if(e.origin!==O)return;var m;try{m=typeof e.data==='string'?JSON.parse(e.data):e.data;}catch(x){return;}if(!m)return;"
            + "if(m.method==='ready'){ready=true;['play','pause','finish','playProgress','error'].forEach(function(ev){f.contentWindow.postMessage(JSON.stringify({method:'addEventListener',value:ev}),O);});post('setVolume',vol);post('play');post('getCurrentSound');send({ev:'ready'});}"
            + "else if(m.method==='playProgress'&&m.value)send({ev:'progress',pos:m.value.currentPosition/1000});"
            + "else if(m.method==='getCurrentSound'&&m.value)send({ev:'sound',dur:(m.value.duration||0)/1000,art:m.value.artwork_url||''});"
            + "else if(m.method)send({ev:m.method});});"
            + "</script></body></html>";
        scp.loadDataWithBaseURL("https://youplay.local/", html, "text/html", "utf-8", null);
    }
    void scLoad(String url) { scp.evaluateJavascript("load(" + JSONObject.quote(url) + ")", null); }
    void scCmd(String m) { scp.evaluateJavascript("cmd(" + JSONObject.quote(m) + ")", null); }
    void scCmd(String m, double v) { scp.evaluateJavascript("cmd(" + JSONObject.quote(m) + "," + v + ")", null); }

    // ── plain HTTP (lyrics, GitHub) ──
    static void fetch(final String url, final Cb cb) {
        Ui.pool.execute(() -> {
            JSONObject r = new JSONObject();
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setRequestProperty("User-Agent", "YouPlay-Android/" + BuildConfig.VERSION);
                c.setConnectTimeout(10000); c.setReadTimeout(15000);
                int code = c.getResponseCode();
                InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                if (in != null) { byte[] b = new byte[16384]; int n; while ((n = in.read(b)) > 0) out.write(b, 0, n); in.close(); }
                r.put("status", code); r.put("body", out.toString("UTF-8"));
            } catch (Exception e) { try { r.put("status", 0); r.put("body", ""); } catch (Exception ignored) {} }
            Ui.main.post(() -> cb.on(r));
        });
    }
    static final Pattern ID = Pattern.compile("x");
    @SuppressWarnings("unused") static Matcher unused(String s) { return ID.matcher(s); }
}
