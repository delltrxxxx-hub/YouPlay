package com.youplay.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.app.DownloadManager;
import android.content.ContentUris;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.RenderEffect;
import android.graphics.Shader;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.text.InputType;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.util.Size;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.BaseAdapter;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** YouPlay for Android: a native interface (Android views) over hidden YouTube Music / SoundCloud helpers. */
public class MainActivity extends Activity implements Player.View {
    static MainActivity current;
    static final String REPO = "delltrxxxx-hub/YouPlay";

    SharedPreferences prefs;
    Engine engine; Player P;
    FrameLayout root, content, npBox, toastBox;
    LinearLayout appBox, tabs, mini;
    final ArrayList<View> stack = new ArrayList<>();
    String tab = "home";
    final Map<String, View> tabRoots = new HashMap<>();
    JSONObject account = new JSONObject();
    boolean engineReady = false, online = true, scLogin = false, scChecked = false; String scUser = "";
    int insetTop, insetBottom;

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        current = this;
        Ui.init(this);
        prefs = getSharedPreferences("youplay", MODE_PRIVATE);
        Ui.ACCENT = prefs.getInt("accent", 0xFFFF5A36);
        Window w = getWindow();
        w.setStatusBarColor(Color.TRANSPARENT); w.setNavigationBarColor(Ui.BG);
        w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);

        root = new FrameLayout(this); root.setBackgroundColor(Ui.BG);
        setContentView(root);
        CookieManager.getInstance().setAcceptCookie(true);
        P = new Player(this); P.view = this;
        engine = new Engine(this, root, readAsset("engine.js"), readAsset("sc.js"), P);
        engine.adblock = prefs.getBoolean("adblock", true);
        P.engine = engine;

        appBox = Ui.col(); appBox.setBackgroundColor(Ui.BG);
        root.addView(appBox, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        content = new FrameLayout(this);
        appBox.addView(content, new LinearLayout.LayoutParams(Ui.MATCH, 0, 1));
        buildMini(); buildTabs(); buildNowPlaying();
        toastBox = new FrameLayout(this);
        root.addView(toastBox, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        root.setOnApplyWindowInsetsListener((v, in) -> {
            if (Build.VERSION.SDK_INT >= 30) { android.graphics.Insets s = in.getInsets(WindowInsets.Type.systemBars()); insetTop = s.top; insetBottom = s.bottom; }
            else { insetTop = in.getSystemWindowInsetTop(); insetBottom = in.getSystemWindowInsetBottom(); }
            appBox.setPadding(0, insetTop, 0, insetBottom);
            npInner.setPadding(Ui.dp(22), insetTop + Ui.dp(6), Ui.dp(22), insetBottom + Ui.dp(14));
            return in;
        });
        showTab("home");
        tick.run();
        Ui.main.post(lyFrameTick);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        watchNetwork();
        Ui.main.postDelayed(() -> Ui.pool.execute(this::checkUpdate), 6000);
    }

    // ═════════ navigation ═════════
    static final String[][] TABS = {{"home", "Главная", "home"}, {"search", "Поиск", "search"}, {"lib", "Библиотека", "library"}, {"settings", "Настройки", "gear"}};
    void buildTabs() {
        tabs = Ui.row(Gravity.CENTER);
        tabs.setBackgroundColor(Ui.BG);
        View line = new View(this); line.setBackgroundColor(0x14FFFFFF);
        appBox.addView(line, new LinearLayout.LayoutParams(Ui.MATCH, 1));
        appBox.addView(tabs, new LinearLayout.LayoutParams(Ui.MATCH, Ui.dp(66)));
        paintTabs();
    }
    void paintTabs() {
        tabs.removeAllViews();
        for (String[] t : TABS) {
            final String id = t[0]; boolean on = id.equals(tab);
            LinearLayout b = Ui.col(); b.setGravity(Gravity.CENTER);
            FrameLayout pillBox = new FrameLayout(this);
            pillBox.setBackground(on ? Ui.round((Ui.ACCENT & 0x00FFFFFF) | 0x33000000, 16) : null);
            pillBox.addView(Ui.icon(t[2], 24, on ? Ui.ACCENT : Ui.MUTED), new FrameLayout.LayoutParams(Ui.dp(24), Ui.dp(24), Gravity.CENTER));
            b.addView(pillBox, new LinearLayout.LayoutParams(Ui.dp(58), Ui.dp(32)));
            TextView l = Ui.line(t[1], 11.5f, on ? Ui.TEXT : Ui.MUTED, on); l.setPadding(0, Ui.dp(4), 0, 0);
            b.addView(l);
            b.setBackground(Ui.ripple(null, false));
            Ui.clickable(b, () -> { if (id.equals(tab) && stack.size() > 1) { while (stack.size() > 1) stack.remove(stack.size() - 1); showTop(); } else showTab(id); });
            tabs.addView(b, Ui.lpw(1));
        }
    }
    void showTab(String id) {
        tab = id; stack.clear();
        View v = tabRoots.get(id);
        if (v == null || "settings".equals(id)) { v = build(id); tabRoots.put(id, v); }
        stack.add(v); showTop(); paintTabs();
    }
    View build(String id) {
        switch (id) { case "search": return searchScreen(); case "lib": return libScreen(); case "settings": return settingsScreen(); default: return homeScreen(); }
    }
    void push(View v) { stack.add(v); showTop(); }
    void showTop() {
        View v = stack.get(stack.size() - 1);
        if (v.getParent() != null) ((ViewGroup) v.getParent()).removeView(v);
        content.removeAllViews();
        content.addView(v, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        hideKeyboard();
    }
    @Override public void onBackPressed() {
        if (npOpen) { closeNP(); return; }
        if (stack.size() > 1) { stack.remove(stack.size() - 1); showTop(); return; }
        if (!"home".equals(tab)) { showTab("home"); return; }
        moveTaskToBack(true);
    }

    // ═════════ building blocks ═════════
    LinearLayout page() { LinearLayout c = Ui.col(); c.setPadding(Ui.dp(18), Ui.dp(14), Ui.dp(18), Ui.dp(24)); return c; }
    ScrollView scroll(View inner) { ScrollView s = new ScrollView(this); s.setVerticalScrollBarEnabled(false); s.setOverScrollMode(View.OVER_SCROLL_NEVER); s.addView(inner); return s; }
    View header(String small, String title) {
        LinearLayout c = Ui.col(); c.setPadding(0, Ui.dp(6), 0, Ui.dp(14));
        if (small != null) { TextView s = Ui.line(small.toUpperCase(), 11.5f, Ui.ACCENT, true); s.setLetterSpacing(0.14f); c.addView(s); c.addView(Ui.space(1, 8)); }
        TextView t = Ui.text(title, 30, Ui.TEXT, true); t.setLetterSpacing(-0.02f); c.addView(t);
        return c;
    }
    View sectionTitle(String s) { TextView t = Ui.line(s, 19, Ui.TEXT, true); t.setPadding(0, Ui.dp(18), 0, Ui.dp(12)); return t; }
    View note(String s) { TextView t = Ui.text(s, 14, Ui.MUTED, false); t.setGravity(Gravity.CENTER); t.setPadding(Ui.dp(12), Ui.dp(28), Ui.dp(12), Ui.dp(28)); t.setLineSpacing(0, 1.25f); return t; }
    View banner(String icon, String title, String sub, String btn, Runnable onClick) {
        LinearLayout b = Ui.row(Gravity.CENTER_VERTICAL);
        b.setPadding(Ui.dp(14), Ui.dp(12), Ui.dp(12), Ui.dp(12));
        b.setBackground(Ui.round(Ui.SURF, 16));
        b.addView(Ui.icon(icon, 24, Ui.ACCENT));
        LinearLayout t = Ui.col(); t.setPadding(Ui.dp(12), 0, Ui.dp(10), 0);
        t.addView(Ui.text(title, 14.5f, Ui.TEXT, true)); TextView s = Ui.text(sub, 12.5f, Ui.MUTED, false); s.setPadding(0, Ui.dp(3), 0, 0); t.addView(s);
        b.addView(t, Ui.lpw(1));
        if (btn != null) b.addView(Ui.pill(btn, true, onClick));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP); lp.topMargin = Ui.dp(10); b.setLayoutParams(lp);
        return b;
    }
    View loading() { TextView t = Ui.text("Загружаю…", 14, Ui.MUTED, false); t.setGravity(Gravity.CENTER); t.setPadding(0, Ui.dp(40), 0, Ui.dp(40)); return t; }
    LinearLayout col(View... vs) { LinearLayout c = Ui.col(); for (View v : vs) c.addView(v); return c; }

    /** A row for one track; reused by lists. */
    final class RowHolder {
        LinearLayout v; ImageView cover; TextView title, artist, badge, dur; FrameLayout dots;
        RowHolder() {
            v = Ui.row(Gravity.CENTER_VERTICAL); v.setPadding(Ui.dp(4), Ui.dp(7), 0, Ui.dp(7));
            v.setBackground(Ui.ripple(new ColorDrawable(Color.TRANSPARENT), true));
            cover = Ui.cover(52, 9); v.addView(cover);
            LinearLayout m = Ui.col(); m.setPadding(Ui.dp(13), 0, Ui.dp(6), 0);
            title = Ui.line("", 15.5f, Ui.TEXT, true);
            LinearLayout sub = Ui.row(Gravity.CENTER_VERTICAL); sub.setPadding(0, Ui.dp(5), 0, 0);
            badge = Ui.badge("yt"); sub.addView(badge);
            artist = Ui.line("", 13, Ui.MUTED, false); artist.setPadding(Ui.dp(7), 0, 0, 0); sub.addView(artist, Ui.lpw(1));
            m.addView(title); m.addView(sub);
            v.addView(m, Ui.lpw(1));
            dur = Ui.line("", 12.5f, Ui.FAINT, false); v.addView(dur);
            dots = Ui.iconButton("dots", 42, 20, Ui.MUTED, 0, null); v.addView(dots);
            v.setTag(this);
        }
        void bind(final Track t, final List<Track> list, final int index, final String name, final JSONObject pl) {
            title.setText(t.title); artist.setText(t.artist);
            boolean on = P.cur != null && P.cur.key().equals(t.key());
            title.setTextColor(on ? Ui.ACCENT : Ui.TEXT);
            String b = "sc".equals(t.src) ? "SoundCloud" : "local".equals(t.src) ? "Файл" : ("video".equals(t.kind) ? "Клип" : "YouTube");
            int c = "sc".equals(t.src) ? Ui.SC : "local".equals(t.src) ? Ui.LOCAL : Ui.YT;
            badge.setText(b); badge.setTextColor(c); badge.setBackground(Ui.round((c & 0x00FFFFFF) | 0x2A000000, 6));
            dur.setText(t.duration > 0 ? Ui.fmt(t.duration) : t.durText);
            Ui.load(cover, t.art, Ui.dp(52) * 2);
            v.setOnClickListener(x -> { if (t.playable()) playList(list, index, name); else if (t.browse != null) openBrowse(t.browse, t.title, t.art); });
            dots.setOnClickListener(x -> trackMenu(t, pl));
        }
    }
    View trackRow(Track t, List<Track> list, int i, String name, JSONObject pl) { RowHolder h = new RowHolder(); h.bind(t, list, i, name, pl); return h.v; }
    class Tracks extends BaseAdapter {
        List<Track> items; String name; JSONObject pl;
        Tracks(List<Track> items, String name, JSONObject pl) { this.items = items; this.name = name; this.pl = pl; }
        public int getCount() { return items.size(); }
        public Object getItem(int i) { return items.get(i); }
        public long getItemId(int i) { return i; }
        public View getView(int i, View conv, ViewGroup parent) {
            RowHolder h = conv != null && conv.getTag() instanceof RowHolder ? (RowHolder) conv.getTag() : new RowHolder();
            h.v.setPadding(Ui.dp(18), Ui.dp(7), Ui.dp(6), Ui.dp(7));
            h.bind(items.get(i), items, i, name, pl);
            return h.v;
        }
    }
    ListView list(View headerView, List<Track> items, String name, JSONObject pl) {
        ListView lv = new ListView(this);
        lv.setDivider(null); lv.setSelector(new ColorDrawable(Color.TRANSPARENT)); lv.setVerticalScrollBarEnabled(false); lv.setOverScrollMode(View.OVER_SCROLL_NEVER);
        lv.setClipToPadding(false); lv.setPadding(0, 0, 0, Ui.dp(16));
        if (headerView != null) lv.addHeaderView(headerView, null, false);
        lv.setAdapter(new Tracks(items, name, pl));
        return lv;
    }
    View cards(final List<Track> items, final String name) {
        HorizontalScrollView hs = new HorizontalScrollView(this); hs.setHorizontalScrollBarEnabled(false); hs.setOverScrollMode(View.OVER_SCROLL_NEVER);
        LinearLayout r = Ui.row(Gravity.TOP);
        for (int i = 0; i < items.size(); i++) {
            final Track t = items.get(i);
            LinearLayout c = Ui.col();
            ImageView img = Ui.cover(0, t.round ? -1 : 14);
            c.addView(img, new LinearLayout.LayoutParams(Ui.dp(148), Ui.dp(148)));
            TextView a = Ui.line(t.title, 14, Ui.TEXT, true); a.setPadding(0, Ui.dp(9), 0, 0); c.addView(a, new LinearLayout.LayoutParams(Ui.dp(148), Ui.WRAP));
            TextView b = Ui.line(t.artist, 12.5f, Ui.MUTED, false); b.setPadding(0, Ui.dp(3), 0, 0); c.addView(b, new LinearLayout.LayoutParams(Ui.dp(148), Ui.WRAP));
            Ui.load(img, t.art, Ui.dp(148));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(Ui.WRAP, Ui.WRAP); lp.rightMargin = Ui.dp(14);
            Ui.clickable(c, () -> {
                if (t.playable()) { List<Track> songs = new ArrayList<>(); for (Track x : items) if (x.playable()) songs.add(x); playList(songs, songs.indexOf(t), name); }
                else if (t.browse != null) openBrowse(t.browse, t.title, t.art);
            });
            r.addView(c, lp);
        }
        hs.addView(r);
        return hs;
    }
    View hero(String art, String iconName, int coverBg, String small, String title, String sub, View... buttons) {
        LinearLayout h = Ui.col(); h.setPadding(Ui.dp(18), Ui.dp(14), Ui.dp(18), Ui.dp(10));
        FrameLayout cv = new FrameLayout(this);
        if (art != null && !art.isEmpty()) { ImageView img = Ui.cover(0, 18); cv.addView(img, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH)); Ui.load(img, art, Ui.dp(180) * 2); }
        else { cv.setBackground(gradient(coverBg)); cv.addView(Ui.icon(iconName, 64, Color.WHITE), new FrameLayout.LayoutParams(Ui.dp(64), Ui.dp(64), Gravity.CENTER)); }
        Ui.clip(cv, 18);
        LinearLayout.LayoutParams cl = new LinearLayout.LayoutParams(Ui.dp(180), Ui.dp(180)); cl.gravity = Gravity.CENTER_HORIZONTAL; h.addView(cv, cl);
        TextView s = Ui.line(small.toUpperCase(), 11.5f, Ui.ACCENT, true); s.setLetterSpacing(0.14f); s.setPadding(0, Ui.dp(18), 0, Ui.dp(6)); h.addView(s);
        h.addView(Ui.text(title, 26, Ui.TEXT, true));
        if (sub != null) { TextView st = Ui.text(sub, 13.5f, Ui.MUTED, false); st.setPadding(0, Ui.dp(6), 0, 0); h.addView(st); }
        LinearLayout br = Ui.row(Gravity.CENTER_VERTICAL); br.setPadding(0, Ui.dp(14), 0, Ui.dp(6));
        for (View b : buttons) { LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(Ui.WRAP, Ui.dp(42)); lp.rightMargin = Ui.dp(8); br.addView(b, lp); }
        h.addView(br);
        return h;
    }
    GradientDrawable gradient(int c) {
        int dark = Color.rgb(Color.red(c) * 55 / 100, Color.green(c) * 55 / 100, Color.blue(c) * 55 / 100);
        return new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[]{c, dark});
    }
    View iconPill(String icon, String label, boolean filled, Runnable r) {
        LinearLayout b = Ui.row(Gravity.CENTER); b.setPadding(Ui.dp(16), 0, Ui.dp(18), 0);
        b.setBackground(Ui.ripple(Ui.round(filled ? Ui.TEXT : Ui.S2, 22), true));
        b.addView(Ui.icon(icon, 18, filled ? 0xFF111111 : Ui.TEXT));
        if (label != null) { TextView t = Ui.text(label, 14, filled ? 0xFF111111 : Ui.TEXT, true); t.setPadding(Ui.dp(8), 0, 0, 0); b.addView(t); }
        else b.setPadding(Ui.dp(12), 0, Ui.dp(12), 0);
        Ui.clickable(b, r);
        return b;
    }

    // ═════════ Главная ═════════
    LinearLayout homeBody;
    View homeScreen() {
        LinearLayout c = page();
        int h = Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
        c.addView(header(h < 6 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер", "Главная"));
        homeBody = Ui.col(); c.addView(homeBody);
        paintHome(cached("home"));
        engine.eng("home", d -> { if (d.optJSONArray("sections") != null && d.optJSONArray("sections").length() > 0) { prefs.edit().putString("home", d.toString()).apply(); paintHome(d); } else if (cached("home") == null) paintHome(null); });
        return scroll(c);
    }
    JSONObject cached(String k) { try { String s = prefs.getString(k, null); return s == null ? null : new JSONObject(s); } catch (Exception e) { return null; } }
    void paintHome(JSONObject d) {
        if (homeBody == null) return;
        homeBody.removeAllViews();
        if (!online) homeBody.addView(banner("music", "Нет интернета", "Музыка с телефона играет без сети", "Открыть", () -> { showTab("lib"); openLocal(); }));
        List<Track> recent = Track.list(jarr("recent"), "yt");
        if (!recent.isEmpty()) { homeBody.addView(sectionTitle("Недавно играло")); homeBody.addView(cards(recent, "Недавно играло")); }
        if (d == null) { homeBody.addView(online ? loading() : note("Подключитесь к интернету, чтобы увидеть подборки")); return; }
        JSONArray secs = d.optJSONArray("sections");
        for (int i = 0; secs != null && i < secs.length(); i++) {
            JSONObject s = secs.optJSONObject(i); if (s == null) continue;
            String title = s.optString("title", ""); if (title.isEmpty()) title = "Для вас";
            List<Track> items = Track.list(s.optJSONArray("items"), "yt");
            if (items.isEmpty()) continue;
            homeBody.addView(sectionTitle(title));
            if ("cards".equals(s.optString("layout"))) homeBody.addView(cards(items, title));
            else { List<Track> top = new ArrayList<>(items.subList(0, Math.min(6, items.size()))); for (int k = 0; k < top.size(); k++) homeBody.addView(trackRow(top.get(k), top, k, title, null)); }
        }
    }

    // ═════════ Поиск ═════════
    LinearLayout searchBody; EditText searchField; String searchFilter = "all"; List<Track> sYt, sSc, sLocal = new ArrayList<>(), sMore; int searchSeq = 0;
    View searchScreen() {
        LinearLayout c = page();
        c.addView(header("YouTube Music · SoundCloud · файлы", "Поиск"));
        LinearLayout box = Ui.row(Gravity.CENTER_VERTICAL); box.setPadding(Ui.dp(14), 0, Ui.dp(6), 0); box.setBackground(Ui.round(Ui.S2, 24));
        box.addView(Ui.icon("search", 20, Ui.MUTED));
        searchField = new EditText(this);
        searchField.setHint("Треки, исполнители, альбомы"); searchField.setHintTextColor(Ui.FAINT); searchField.setTextColor(Ui.TEXT); searchField.setTextSize(16);
        searchField.setBackground(null); searchField.setSingleLine(true); searchField.setImeOptions(EditorInfo.IME_ACTION_SEARCH); searchField.setInputType(InputType.TYPE_CLASS_TEXT);
        searchField.setPadding(Ui.dp(10), 0, 0, 0);
        box.addView(searchField, new LinearLayout.LayoutParams(0, Ui.dp(50), 1));
        box.addView(Ui.iconButton("close", 40, 18, Ui.MUTED, 0, () -> { searchField.setText(""); searchField.requestFocus(); showKeyboard(searchField); }));
        c.addView(box);
        searchField.setOnEditorActionListener((v, a, e) -> { if (a == EditorInfo.IME_ACTION_SEARCH || (e != null && e.getKeyCode() == KeyEvent.KEYCODE_ENTER)) { doSearch(v.getText().toString().trim()); return true; } return false; });
        searchBody = Ui.col(); c.addView(searchBody);
        searchBody.addView(note("Ищите сразу в YouTube Music, SoundCloud и музыке на телефоне"));
        return scroll(c);
    }
    void doSearch(final String q) {
        if (q.isEmpty()) return;
        hideKeyboard();
        final int my = ++searchSeq;
        sYt = null; sSc = null; sMore = new ArrayList<>(); sLocal = new ArrayList<>();
        String ql = q.toLowerCase();
        for (Track t : localTracks()) if ((t.title + " " + t.artist).toLowerCase().contains(ql)) sLocal.add(t);
        if (!online) { sYt = new ArrayList<>(); sSc = new ArrayList<>(); paintSearch(q); return; }
        paintSearch(q);
        engine.eng("search", d -> { if (my != searchSeq) return; sYt = Track.list(d.optJSONArray("tracks"), "yt"); sMore = Track.list(d.optJSONArray("more"), "yt"); paintSearch(q); }, "q", q);
        engine.sc("search", q, d -> { if (my != searchSeq) return; sSc = Track.list(d.optJSONArray("items"), "sc"); for (Track t : sSc) t.src = "sc"; paintSearch(q); });
    }
    void paintSearch(final String q) {
        searchBody.removeAllViews();
        LinearLayout chips = Ui.row(Gravity.CENTER_VERTICAL); chips.setPadding(0, Ui.dp(14), 0, Ui.dp(4));
        String[][] fs = {{"all", "Всё"}, {"yt", "YouTube"}, {"sc", "SoundCloud"}, {"local", "Файлы"}};
        for (String[] f : fs) {
            final String id = f[0];
            int n = "yt".equals(id) ? (sYt == null ? -1 : sYt.size()) : "sc".equals(id) ? (sSc == null ? -1 : sSc.size()) : "local".equals(id) ? sLocal.size() : -2;
            TextView ch = Ui.chip(f[1] + (n >= 0 ? "  " + n : n == -1 ? "  …" : ""), id.equals(searchFilter));
            Ui.clickable(ch, () -> { searchFilter = id; paintSearch(q); });
            chips.addView(ch);
        }
        HorizontalScrollView hs = new HorizontalScrollView(this); hs.setHorizontalScrollBarEnabled(false); hs.addView(chips); searchBody.addView(hs);
        if (("all".equals(searchFilter) || "yt".equals(searchFilter)) && sMore != null && !sMore.isEmpty()) { searchBody.addView(sectionTitle("Альбомы и исполнители")); searchBody.addView(cards(new ArrayList<>(sMore.subList(0, Math.min(12, sMore.size()))), q)); }
        List<Track> merged = new ArrayList<>();
        List<Track> a = "sc".equals(searchFilter) || "local".equals(searchFilter) || sYt == null ? new ArrayList<Track>() : sYt;
        List<Track> b = "yt".equals(searchFilter) || "local".equals(searchFilter) || sSc == null ? new ArrayList<Track>() : sSc;
        for (int i = 0; i < Math.max(a.size(), b.size()); i++) { if (i < a.size() && !isDisliked(a.get(i))) merged.add(a.get(i)); if (i < b.size() && !isDisliked(b.get(i))) merged.add(b.get(i)); }
        if ("local".equals(searchFilter)) merged.addAll(sLocal); else if ("all".equals(searchFilter)) merged.addAll(sLocal.subList(0, Math.min(5, sLocal.size())));
        if (!merged.isEmpty()) searchBody.addView(sectionTitle("Треки"));
        for (int i = 0; i < merged.size(); i++) searchBody.addView(trackRow(merged.get(i), merged, i, "Поиск: " + q, null));
        if (merged.isEmpty()) searchBody.addView(sYt == null || sSc == null ? loading() : note("Ничего не нашлось"));
    }

    // ═════════ Библиотека ═════════
    JSONObject plYt, plSc; long plAt = 0; boolean plBusy = false; String libFilter = "all";
    LinearLayout libBody;
    View libScreen() {
        LinearLayout c = page();
        c.addView(header("Всё в одном месте", "Библиотека"));
        libBody = Ui.col(); c.addView(libBody);
        paintLib();
        loadRemotePlaylists(false, this::paintLib);
        return scroll(c);
    }
    void loadRemotePlaylists(boolean force, final Runnable done) {
        if (!online || plBusy || (!force && plAt > 0 && System.currentTimeMillis() - plAt < 5 * 60000)) { if (done != null) done.run(); return; }
        plBusy = true;
        final int[] left = {2};
        final Runnable fin = () -> { if (--left[0] == 0) { plBusy = false; plAt = System.currentTimeMillis(); if (done != null) done.run(); } };
        engine.eng("playlists", d -> { plYt = d; fin.run(); });
        engine.sc("sets", "", d -> { plSc = d; if (d.has("login")) { scLogin = d.optBoolean("login"); scChecked = true; } fin.run(); });
    }
    void paintLib() {
        if (libBody == null) return;
        libBody.removeAllViews();
        LinearLayout chips = Ui.row(Gravity.CENTER_VERTICAL); chips.setPadding(0, 0, 0, Ui.dp(14));
        String[][] fs = {{"all", "Всё"}, {"yp", "YouPlay"}, {"yt", "YouTube"}, {"sc", "SoundCloud"}};
        for (String[] f : fs) { final String id = f[0]; TextView ch = Ui.chip(f[1], id.equals(libFilter)); Ui.clickable(ch, () -> { libFilter = id; paintLib(); }); chips.addView(ch); }
        HorizontalScrollView hs = new HorizontalScrollView(this); hs.setHorizontalScrollBarEnabled(false); hs.addView(chips); libBody.addView(hs);
        List<View> tiles = new ArrayList<>();
        tiles.add(tile(null, "plus", 0, "Новый плейлист", "YouPlay, YouTube или SoundCloud", null, () -> createPlaylist(null), true));
        if ("all".equals(libFilter) || "yp".equals(libFilter)) {
            tiles.add(tile(null, "heart", Ui.ACCENT, "Любимое", "Лайки YouTube и SoundCloud", null, this::openLikes, false));
            tiles.add(tile(null, "phone", 0xFF3A332F, "Моя музыка", "Файлы · без интернета", null, this::openLocal, false));
            JSONArray pls = jarr("playlists");
            for (int i = 0; i < pls.length(); i++) {
                final JSONObject p = pls.optJSONObject(i); if (p == null) continue;
                JSONArray items = p.optJSONArray("items");
                tiles.add(tile(firstArt(items), "library", Ui.S3, p.optString("name"), "YouPlay · " + (items == null ? 0 : items.length()) + " тр.", null, () -> openPlaylist(p.optString("id")), false));
            }
        }
        if (("all".equals(libFilter) || "yt".equals(libFilter)) && plYt != null && plYt.optJSONArray("items") != null) {
            JSONArray a = plYt.optJSONArray("items");
            for (int i = 0; i < a.length(); i++) { final JSONObject p = a.optJSONObject(i); tiles.add(tile(p.optString("art"), "yt", Ui.S3, p.optString("title"), p.optString("sub", "YouTube Music"), "yt", () -> openBrowse(p.optString("browse"), p.optString("title"), p.optString("art")), false)); }
        }
        if (("all".equals(libFilter) || "sc".equals(libFilter)) && plSc != null && plSc.optJSONArray("items") != null) {
            JSONArray a = plSc.optJSONArray("items");
            for (int i = 0; i < a.length(); i++) { final JSONObject p = a.optJSONObject(i); tiles.add(tile(p.optString("art"), "cloud", Ui.S3, p.optString("title"), p.optInt("count") + " тр.", "sc", () -> openScSet(p.optString("url"), p.optString("title"), p.optString("art")), false)); }
        }
        for (int i = 0; i < tiles.size(); i += 2) {
            LinearLayout r = Ui.row(Gravity.TOP); r.setPadding(0, 0, 0, Ui.dp(16));
            r.addView(tiles.get(i), Ui.lpw(1)); r.addView(Ui.space(14, 1));
            if (i + 1 < tiles.size()) r.addView(tiles.get(i + 1), Ui.lpw(1)); else r.addView(new View(this), Ui.lpw(1));
            libBody.addView(r);
        }
        if (plBusy && plAt == 0) libBody.addView(loading());
        boolean ytOut = plYt != null && plYt.has("login") && !plYt.optBoolean("login", true), scOut = plSc != null && plSc.has("login") && !plSc.optBoolean("login", true);
        if ((ytOut && !"sc".equals(libFilter)) || (scOut && !"yt".equals(libFilter)))
            libBody.addView(banner("user", "Подключите аккаунты", (ytOut ? "YouTube Music " : "") + (ytOut && scOut ? "и " : "") + (scOut ? "SoundCloud " : "") + "— тогда здесь будут ваши плейлисты", "Войти", () -> showTab("settings")));
    }
    String firstArt(JSONArray items) { for (int i = 0; items != null && i < items.length(); i++) { String a = items.optJSONObject(i).optString("art"); if (!a.isEmpty()) return a; } return null; }
    View tile(String art, String icon, int bg, String title, String sub, String src, Runnable onClick, boolean dashed) {
        LinearLayout c = Ui.col();
        FrameLayout cv = new FrameLayout(this);
        int w = (getResources().getDisplayMetrics().widthPixels - Ui.dp(36 + 14)) / 2;
        if (art != null && !art.isEmpty()) { ImageView img = Ui.cover(0, 16); cv.addView(img, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH)); Ui.load(img, art, w); }
        else if (dashed) { GradientDrawable g = Ui.round(Color.TRANSPARENT, 16); g.setStroke(Ui.dp(2), Ui.S3, Ui.dp(8), Ui.dp(6)); cv.setBackground(g); cv.addView(Ui.icon(icon, 40, Ui.ACCENT), new FrameLayout.LayoutParams(Ui.dp(40), Ui.dp(40), Gravity.CENTER)); }
        else { cv.setBackground(gradient(bg)); cv.addView(Ui.icon(icon, 44, Color.WHITE), new FrameLayout.LayoutParams(Ui.dp(44), Ui.dp(44), Gravity.CENTER)); }
        if (src != null) { TextView b = Ui.badge(src); FrameLayout.LayoutParams bl = new FrameLayout.LayoutParams(Ui.WRAP, Ui.WRAP, Gravity.BOTTOM | Gravity.START); bl.setMargins(Ui.dp(8), 0, 0, Ui.dp(8)); b.setBackground(Ui.round(0xCC000000, 6)); cv.addView(b, bl); }
        Ui.clip(cv, 16);
        c.addView(cv, new LinearLayout.LayoutParams(Ui.MATCH, w));
        TextView t = Ui.line(title, 14.5f, Ui.TEXT, true); t.setPadding(0, Ui.dp(9), 0, 0); c.addView(t);
        TextView s = Ui.line(sub, 12.5f, Ui.MUTED, false); s.setPadding(0, Ui.dp(3), 0, 0); c.addView(s);
        Ui.clickable(c, onClick);
        return c;
    }

    // ═════════ Любимое ═════════
    void openLikes() {
        final FrameLayout box = new FrameLayout(this);
        push(box);
        final Runnable paint = () -> {
            final List<Track> all = mergedLikes();
            JSONObject lc = cached("likes");
            int ny = lc == null || lc.optJSONArray("yt") == null ? 0 : lc.optJSONArray("yt").length(), ns = lc == null || lc.optJSONArray("sc") == null ? 0 : lc.optJSONArray("sc").length();
            LinearLayout head = (LinearLayout) hero(null, "heart", Ui.ACCENT, "Плейлист", "Любимое", "YouTube " + ny + " · SoundCloud " + (scChecked && !scLogin ? "не подключён" : String.valueOf(ns)),
                iconPill("play", "Слушать", true, () -> playList(all, 0, "Любимое")), iconPill("shuffle", "Перемешать", false, () -> { List<Track> s = new ArrayList<>(all); Collections.shuffle(s); playList(s, 0, "Любимое"); }),
                iconPill("update", null, false, () -> { toast("Обновляю лайки…"); loadLikes(true, null); }));
            if (engineReady && !account.optBoolean("signedIn")) head.addView(banner("yt", "Войдите в YouTube Music", "Чтобы здесь были ваши лайки", "Войти", this::googleLogin));
            if (scChecked && !scLogin) head.addView(banner("cloud", "Подключите SoundCloud", "Лайки обоих сервисов соберутся по датам", "Войти", this::scLoginDialog));
            box.removeAllViews();
            box.addView(all.isEmpty() ? scroll(col(head, note(lc == null ? "Загружаю лайки…" : "Пока пусто. Лайкайте треки сердечком."))) : list(head, all, "Любимое", null));
        };
        paint.run();
        loadLikes(false, paint);
    }
    void loadLikes(boolean force, final Runnable done) {
        JSONObject lc = cached("likes");
        if (!online || (!force && lc != null && System.currentTimeMillis() - lc.optLong("at") < 10 * 60000)) { if (done != null) done.run(); return; }
        final JSONObject out = lc == null ? new JSONObject() : lc;
        final int[] left = {2};
        final Runnable fin = () -> { if (--left[0] == 0) { try { out.put("at", System.currentTimeMillis()); } catch (Exception ignored) {} prefs.edit().putString("likes", out.toString()).apply(); if (done != null) done.run(); } };
        engine.eng("likes", d -> { try { if (d.optJSONArray("tracks") != null) out.put("yt", d.optJSONArray("tracks")); } catch (Exception ignored) {} fin.run(); });
        engine.sc("likes", "", d -> { try { if (d.has("login")) { scLogin = d.optBoolean("login"); scChecked = true; scUser = d.optString("user", scUser); } if (d.optJSONArray("items") != null) out.put("sc", d.optJSONArray("items")); else if (d.has("login") && !d.optBoolean("login")) out.put("sc", new JSONArray()); } catch (Exception ignored) {} fin.run(); });
    }
    List<Track> mergedLikes() {
        JSONObject lc = cached("likes");
        List<Track> yt = Track.list(lc == null ? null : lc.optJSONArray("yt"), "yt"), sc = Track.list(lc == null ? null : lc.optJSONArray("sc"), "sc");
        for (Track t : sc) t.src = "sc";
        final Map<Track, Long> when = new HashMap<>();
        long oldest = System.currentTimeMillis();
        for (Track t : sc) { long ms = parseIso(t.likedAt); when.put(t, ms); if (ms > 0 && ms < oldest) oldest = ms; }
        long top = System.currentTimeMillis();
        for (int i = 0; i < yt.size(); i++) when.put(yt.get(i), top - (yt.size() > 1 ? (long) ((double) i / (yt.size() - 1) * (top - oldest)) : 0));
        List<Track> all = new ArrayList<>(); all.addAll(yt); all.addAll(sc);
        Collections.sort(all, (a, b) -> Long.compare(when.containsKey(b) ? when.get(b) : 0L, when.containsKey(a) ? when.get(a) : 0L));
        List<Track> out = new ArrayList<>(); for (Track t : all) if (!isDisliked(t)) out.add(t);
        return out;
    }
    static long parseIso(String s) { try { return s == null ? 0 : java.time.Instant.parse(s).toEpochMilli(); } catch (Exception e) { return 0; } }
    boolean scLiked(String url) { JSONObject lc = cached("likes"); JSONArray a = lc == null ? null : lc.optJSONArray("sc"); for (int i = 0; a != null && i < a.length(); i++) if (url != null && url.equals(a.optJSONObject(i).optString("url"))) return true; return false; }

    // ═════════ Моя музыка ═════════
    boolean audioAllowed() { return checkSelfPermission(Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_AUDIO : Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED; }
    List<Track> localTracks() {
        List<Track> out = new ArrayList<>();
        if (!audioAllowed()) return out;
        String[] cols = {MediaStore.Audio.Media._ID, MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.ARTIST, MediaStore.Audio.Media.DURATION, MediaStore.Audio.Media.ALBUM_ID};
        try (Cursor c = getContentResolver().query(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, cols, MediaStore.Audio.Media.IS_MUSIC + "!=0", null, MediaStore.Audio.Media.ARTIST + " COLLATE NOCASE, " + MediaStore.Audio.Media.TITLE + " COLLATE NOCASE")) {
            while (c != null && c.moveToNext()) {
                Track t = new Track(); t.src = "local"; t.id = String.valueOf(c.getLong(0));
                t.title = c.getString(1) == null ? "Без названия" : c.getString(1);
                String a = c.getString(2); t.artist = a == null || "<unknown>".equals(a) ? "Неизвестный исполнитель" : a;
                t.duration = c.getLong(3) / 1000.0; t.art = "art:" + c.getLong(4);
                out.add(t);
            }
        } catch (Exception ignored) {}
        return out;
    }
    FrameLayout localBox;
    void openLocal() { localBox = new FrameLayout(this); push(localBox); paintLocal(); }
    void paintLocal() {
        if (localBox == null) return;
        localBox.removeAllViews();
        final List<Track> l = localTracks();
        LinearLayout head = (LinearLayout) hero(null, "phone", 0xFF3A332F, "Работает без интернета", "Моя музыка", audioAllowed() ? l.size() + " треков на телефоне" : "Нужен доступ к музыке",
            iconPill("play", "Слушать", true, () -> playList(l, 0, "Моя музыка")), iconPill("shuffle", "Перемешать", false, () -> { List<Track> s = new ArrayList<>(l); Collections.shuffle(s); playList(s, 0, "Моя музыка"); }));
        if (!audioAllowed()) { head.addView(banner("music", "Разрешите доступ к аудио", "YouPlay покажет и сыграет музыку с телефона", "Разрешить", () -> requestPermissions(new String[]{Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_AUDIO : Manifest.permission.READ_EXTERNAL_STORAGE}, 2))); localBox.addView(scroll(head)); return; }
        localBox.addView(l.isEmpty() ? scroll(col(head, note("На телефоне нет музыкальных файлов"))) : list(head, l, "Моя музыка", null));
    }
    @Override public void onRequestPermissionsResult(int code, String[] p, int[] r) { if (code == 2) paintLocal(); }
    Bitmap albumArt(String url, int px) {
        try {
            long album = Long.parseLong(url.substring(4));
            Uri u = ContentUris.withAppendedId(MediaStore.Audio.Albums.EXTERNAL_CONTENT_URI, album);
            if (Build.VERSION.SDK_INT >= 29) return getContentResolver().loadThumbnail(u, new Size(px, px), null);
            return BitmapFactory.decodeStream(getContentResolver().openInputStream(ContentUris.withAppendedId(Uri.parse("content://media/external/audio/albumart"), album)));
        } catch (Exception e) { return null; }
    }

    // ═════════ pages: YouTube album/playlist/artist, YouPlay playlist, SoundCloud playlist ═════════
    void openBrowse(final String href, final String title, final String art) {
        final FrameLayout box = new FrameLayout(this); box.addView(scroll(col(hero(art, "yt", Ui.S3, "YouTube Music", title, "Загружаю…"), loading())));
        push(box);
        engine.eng("browse", d -> {
            final List<Track> l = new ArrayList<>(); for (Track t : Track.list(d.optJSONArray("tracks"), "yt")) if (!isDisliked(t)) l.add(t);
            String a2 = art == null || art.isEmpty() ? d.optString("art") : art;
            String t2 = d.optString("title", ""); if (t2.isEmpty()) t2 = title;
            View head = hero(a2, "yt", Ui.S3, "YouTube Music", t2, d.optString("subtitle", "").isEmpty() ? l.size() + " треков" : d.optString("subtitle"),
                iconPill("play", "Слушать", true, () -> playList(l, 0, title)), iconPill("shuffle", "Перемешать", false, () -> { List<Track> s = new ArrayList<>(l); Collections.shuffle(s); playList(s, 0, title); }));
            box.removeAllViews();
            if (!l.isEmpty()) { box.addView(list(head, l, title, null)); return; }
            LinearLayout c = col(head); c.setPadding(0, 0, 0, Ui.dp(20));
            JSONArray secs = d.optJSONArray("sections");
            for (int i = 0; secs != null && i < secs.length(); i++) {
                JSONObject s = secs.optJSONObject(i); List<Track> items = Track.list(s.optJSONArray("items"), "yt"); if (items.isEmpty()) continue;
                LinearLayout sec = Ui.col(); sec.setPadding(Ui.dp(18), 0, Ui.dp(18), 0);
                sec.addView(sectionTitle(s.optString("title")));
                if ("cards".equals(s.optString("layout"))) sec.addView(cards(items, s.optString("title"))); else for (int k = 0; k < items.size(); k++) sec.addView(trackRow(items.get(k), items, k, s.optString("title"), null));
                c.addView(sec);
            }
            if (secs == null || secs.length() == 0) c.addView(note("Здесь пока пусто"));
            box.addView(scroll(c));
        }, "href", href);
    }
    JSONObject findPlaylist(String id) { JSONArray a = jarr("playlists"); for (int i = 0; i < a.length(); i++) if (id.equals(a.optJSONObject(i).optString("id"))) return a.optJSONObject(i); return null; }
    FrameLayout plBox; String plOpen;
    void openPlaylist(String id) { plBox = new FrameLayout(this); plOpen = id; push(plBox); paintPlaylist(); }
    void paintPlaylist() {
        if (plBox == null || plOpen == null) return;
        final JSONObject p = findPlaylist(plOpen); if (p == null) return;
        final List<Track> l = new ArrayList<>(); for (Track t : Track.list(p.optJSONArray("items"), "yt")) if (!isDisliked(t)) l.add(t);
        final String name = p.optString("name");
        View head = hero(firstArt(p.optJSONArray("items")), "library", Ui.S3, "Плейлист YouPlay", name, l.size() + " тр. · YouTube, SoundCloud и файлы вместе",
            iconPill("play", "Слушать", true, () -> playList(l, 0, name)), iconPill("shuffle", null, false, () -> { List<Track> s = new ArrayList<>(l); Collections.shuffle(s); playList(s, 0, name); }),
            iconPill("dots", null, false, () -> playlistMenu(p)));
        plBox.removeAllViews();
        plBox.addView(l.isEmpty() ? scroll(col(head, note("Пока пусто. Нажмите ⋯ у любого трека → «Добавить в плейлист»."))) : list(head, l, name, p));
    }
    void openScSet(final String url, final String title, final String art) {
        final FrameLayout box = new FrameLayout(this); box.addView(scroll(col(hero(art, "cloud", Ui.S3, "SoundCloud", title, "Загружаю…"), loading())));
        push(box);
        engine.sc("set", url, d -> {
            final List<Track> l = new ArrayList<>(); for (Track t : Track.list(d.optJSONArray("items"), "sc")) { t.src = "sc"; if (!isDisliked(t)) l.add(t); }
            View head = hero(art, "cloud", Ui.S3, "SoundCloud", title, l.size() + " тр.", iconPill("play", "Слушать", true, () -> playList(l, 0, title)), iconPill("shuffle", "Перемешать", false, () -> { List<Track> s = new ArrayList<>(l); Collections.shuffle(s); playList(s, 0, title); }));
            box.removeAllViews();
            box.addView(l.isEmpty() ? scroll(col(head, note("Не удалось открыть плейлист SoundCloud"))) : list(head, l, title, null));
        });
    }

    // ═════════ sheets: track menu, playlists ═════════
    Dialog sheet(View body) {
        final Dialog d = new Dialog(this);
        d.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout c = Ui.col(); c.setPadding(Ui.dp(18), Ui.dp(10), Ui.dp(18), Ui.dp(18) + insetBottom);
        GradientDrawable bg = new GradientDrawable(); bg.setColor(Ui.SURF); float r = Ui.dp(24); bg.setCornerRadii(new float[]{r, r, r, r, 0, 0, 0, 0}); c.setBackground(bg);
        View grab = new View(this); grab.setBackground(Ui.round(Ui.S3, 3)); LinearLayout.LayoutParams gl = new LinearLayout.LayoutParams(Ui.dp(38), Ui.dp(5)); gl.gravity = Gravity.CENTER_HORIZONTAL; gl.bottomMargin = Ui.dp(14); c.addView(grab, gl);
        c.addView(body);
        d.setContentView(c);
        Window w = d.getWindow();
        if (w != null) { w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT)); w.setLayout(Ui.MATCH, Ui.WRAP); w.setGravity(Gravity.BOTTOM); w.setDimAmount(0.6f); w.setWindowAnimations(android.R.style.Animation_InputMethod); w.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE); }
        d.show();
        return d;
    }
    View menuItem(String icon, String label, Runnable r) {
        LinearLayout b = Ui.row(Gravity.CENTER_VERTICAL); b.setPadding(Ui.dp(8), 0, Ui.dp(8), 0);
        b.setBackground(Ui.ripple(Ui.round(Color.TRANSPARENT, 12), true));
        b.addView(Ui.icon(icon, 22, Ui.MUTED));
        TextView t = Ui.line(label, 15.5f, Ui.TEXT, true); t.setPadding(Ui.dp(16), 0, 0, 0); b.addView(t, Ui.lpw(1));
        b.setLayoutParams(new LinearLayout.LayoutParams(Ui.MATCH, Ui.dp(52)));
        Ui.clickable(b, r);
        return b;
    }
    View sheetHead(Track t) {
        LinearLayout h = Ui.row(Gravity.CENTER_VERTICAL); h.setPadding(0, 0, 0, Ui.dp(12));
        ImageView cv = Ui.cover(54, 10); Ui.load(cv, t.art, Ui.dp(54) * 2); h.addView(cv);
        LinearLayout m = Ui.col(); m.setPadding(Ui.dp(14), 0, 0, 0);
        m.addView(Ui.line(t.title, 16, Ui.TEXT, true));
        LinearLayout s = Ui.row(Gravity.CENTER_VERTICAL); s.setPadding(0, Ui.dp(5), 0, 0); s.addView(Ui.badge(t.src)); TextView a = Ui.line(t.artist, 13, Ui.MUTED, false); a.setPadding(Ui.dp(7), 0, 0, 0); s.addView(a); m.addView(s);
        h.addView(m, Ui.lpw(1));
        return h;
    }
    void trackMenu(final Track t, final JSONObject pl) {
        LinearLayout c = Ui.col();
        c.addView(sheetHead(t));
        final Dialog[] d = new Dialog[1];
        c.addView(menuItem("play", "Играть сейчас", () -> { d[0].dismiss(); List<Track> l = new ArrayList<>(); l.add(t); playList(l, 0, t.title); }));
        c.addView(menuItem("queue", "Играть следующим", () -> { d[0].dismiss(); P.addNext(t); toast("Будет играть следующим"); }));
        c.addView(menuItem("plus", "Добавить в плейлист…", () -> { d[0].dismiss(); addToPlaylist(t); }));
        if (pl != null) c.addView(menuItem("close", "Убрать из «" + pl.optString("name") + "»", () -> { d[0].dismiss(); removeFromPlaylist(pl, t); }));
        if ("sc".equals(t.src)) { final boolean liked = scLiked(t.url); c.addView(menuItem(liked ? "heart" : "heartLine", liked ? "Убрать лайк в SoundCloud" : "Лайк в SoundCloud", () -> { d[0].dismiss(); likeSc(t); })); }
        c.addView(menuItem("broken", "Не предлагать этот трек", () -> { d[0].dismiss(); dislike(t); }));
        d[0] = sheet(c);
    }
    void playlistMenu(final JSONObject p) {
        LinearLayout c = Ui.col(); final Dialog[] d = new Dialog[1];
        c.addView(menuItem("lyrics", "Переименовать", () -> { d[0].dismiss(); askText("Название плейлиста", p.optString("name"), v -> { try { p.put("name", v); } catch (Exception ignored) {} savePlaylist(p); paintPlaylist(); paintLib(); }); }));
        c.addView(menuItem("close", "Удалить плейлист", () -> { d[0].dismiss(); new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert).setTitle("Удалить «" + p.optString("name") + "»?").setMessage("Треки останутся в YouTube Music и SoundCloud.").setNegativeButton("Отмена", null).setPositiveButton("Удалить", (x, y) -> { deletePlaylist(p.optString("id")); plOpen = null; onBackPressed(); toast("Плейлист удалён"); }).show(); }));
        d[0] = sheet(c);
    }
    interface Str { void on(String s); }
    void askText(String title, String value, final Str done) {
        LinearLayout c = Ui.col();
        c.addView(Ui.text(title, 20, Ui.TEXT, true));
        final EditText e = field(value);
        c.addView(e);
        final Dialog[] d = new Dialog[1];
        LinearLayout r = Ui.row(Gravity.END); r.addView(Ui.pill("Сохранить", true, () -> { String v = e.getText().toString().trim(); if (v.isEmpty()) return; d[0].dismiss(); done.on(v); })); c.addView(r);
        d[0] = sheet(c);
        e.requestFocus(); Ui.main.postDelayed(() -> showKeyboard(e), 150);
    }
    EditText field(String value) {
        EditText e = new EditText(this); e.setText(value == null ? "" : value); e.setSingleLine(true); e.setTextColor(Ui.TEXT); e.setHintTextColor(Ui.FAINT); e.setTextSize(16);
        e.setBackground(Ui.round(Ui.S2, 14)); e.setPadding(Ui.dp(14), 0, Ui.dp(14), 0);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(Ui.MATCH, Ui.dp(52)); lp.topMargin = Ui.dp(14); lp.bottomMargin = Ui.dp(14); e.setLayoutParams(lp);
        return e;
    }
    View pick(String art, String icon, int iconColor, String title, String sub, boolean check, Runnable r) {
        LinearLayout b = Ui.row(Gravity.CENTER_VERTICAL); b.setPadding(Ui.dp(10), Ui.dp(8), Ui.dp(12), Ui.dp(8));
        b.setBackground(Ui.ripple(Ui.round(Ui.S2, 14), true));
        FrameLayout pc = new FrameLayout(this); pc.setBackground(Ui.round(Ui.S3, 10)); Ui.clip(pc, 10);
        if (art != null && !art.isEmpty()) { ImageView img = Ui.cover(0, 10); pc.addView(img, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH)); Ui.load(img, art, Ui.dp(88)); }
        else pc.addView(Ui.icon(icon, 22, iconColor), new FrameLayout.LayoutParams(Ui.dp(22), Ui.dp(22), Gravity.CENTER));
        b.addView(pc, new LinearLayout.LayoutParams(Ui.dp(46), Ui.dp(46)));
        LinearLayout m = Ui.col(); m.setPadding(Ui.dp(12), 0, 0, 0);
        m.addView(Ui.line(title, 15, Ui.TEXT, true)); TextView s = Ui.text(sub, 12.5f, Ui.MUTED, false); s.setPadding(0, Ui.dp(3), 0, 0); m.addView(s);
        b.addView(m, Ui.lpw(1));
        if (check) b.addView(Ui.icon("check", 20, Ui.ACCENT));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP); lp.bottomMargin = Ui.dp(8); b.setLayoutParams(lp);
        if (r != null) Ui.clickable(b, r);
        return b;
    }
    void addToPlaylist(final Track t) {
        final LinearLayout c = Ui.col();
        c.addView(Ui.text("В плейлист", 20, Ui.TEXT, true));
        TextView hint = Ui.text("«" + t.title + "» · " + ("yt".equals(t.src) ? "плейлисты YouPlay и YouTube Music" : "sc".equals(t.src) ? "плейлисты YouPlay и SoundCloud" : "плейлисты YouPlay"), 13, Ui.MUTED, false);
        hint.setPadding(0, Ui.dp(6), 0, Ui.dp(14)); c.addView(hint);
        final LinearLayout list = Ui.col();
        c.addView(scroll(list), new LinearLayout.LayoutParams(Ui.MATCH, Math.min(Ui.dp(420), getResources().getDisplayMetrics().heightPixels / 2)));
        final Dialog d = sheet(c);
        final Runnable draw = () -> {
            list.removeAllViews();
            list.addView(pick(null, "plus", Ui.ACCENT, "Новый плейлист", "Создать и добавить трек", false, () -> { d.dismiss(); createPlaylist(t); }));
            JSONArray pls = jarr("playlists");
            for (int i = 0; i < pls.length(); i++) {
                final JSONObject p = pls.optJSONObject(i); final boolean has = plHas(p, t);
                list.addView(pick(firstArt(p.optJSONArray("items")), "library", Ui.ACCENT, p.optString("name"), "YouPlay · " + p.optJSONArray("items").length() + " тр.", has, () -> { d.dismiss(); if (has) toast("Уже есть в «" + p.optString("name") + "»"); else { addTo(p, t); toast("Добавлено в «" + p.optString("name") + "»"); } }));
            }
            if ("yt".equals(t.src) && plYt != null && plYt.optJSONArray("items") != null) {
                JSONArray a = plYt.optJSONArray("items");
                for (int i = 0; i < a.length(); i++) { final JSONObject p = a.optJSONObject(i); list.addView(pick(p.optString("art"), "yt", Ui.YT, p.optString("title"), "YouTube Music", false, () -> { d.dismiss(); toast("Добавляю в YouTube Music…"); engine.eng("plAdd", r -> toast(r.optBoolean("ok") ? "✓ Добавлено в «" + p.optString("title") + "»" : r.has("login") ? "Войдите в YouTube Music" : "YouTube Music не принял трек"), "videoId", t.videoId, "title", t.title, "artist", t.artist, "playlist", p.optString("title")); })); }
            }
            if ("sc".equals(t.src) && plSc != null && plSc.optJSONArray("items") != null) {
                JSONArray a = plSc.optJSONArray("items");
                for (int i = 0; i < a.length(); i++) { final JSONObject p = a.optJSONObject(i); if (!p.optBoolean("mine", true)) continue; list.addView(pick(p.optString("art"), "cloud", Ui.SC, p.optString("title"), "SoundCloud · " + p.optInt("count") + " тр.", false, () -> { d.dismiss(); toast("Добавляю в SoundCloud…"); engine.sc("addto", t.url + "#name=" + enc(p.optString("title")), r -> toast(r.optBoolean("ok") ? "✓ Добавлено в «" + p.optString("title") + "»" : "SoundCloud не принял трек")); })); }
            }
            if (plBusy) list.addView(note("Загружаю плейлисты из аккаунтов…"));
        };
        draw.run();
        if (!"local".equals(t.src)) loadRemotePlaylists(false, () -> { if (d.isShowing()) draw.run(); });
    }
    static String enc(String s) { try { return URLEncoder.encode(s, "UTF-8").replace("+", "%20"); } catch (Exception e) { return s; } }
    void createPlaylist(final Track t) {
        final boolean ytIn = account.optBoolean("signedIn");
        final boolean ytOk = ytIn && (t == null || "yt".equals(t.src)), scOk = scLogin && t != null && "sc".equals(t.src);
        LinearLayout c = Ui.col();
        c.addView(Ui.text("Новый плейлист", 20, Ui.TEXT, true));
        final EditText e = field(""); e.setHint("Название плейлиста"); c.addView(e);
        final String[] where = {"yp"};
        final List<View> opts = new ArrayList<>();
        String[][] ws = {{"yp", "library", "YouPlay", "Любые треки вместе: YouTube, SoundCloud и файлы"},
            {"yt", "yt", "YouTube Music", ytOk ? "Сохранится в вашем аккаунте YouTube Music" : !ytIn ? "Войдите в YouTube Music в настройках" : "Сюда можно только треки YouTube"},
            {"sc", "cloud", "SoundCloud", scOk ? "Сохранится в вашем аккаунте SoundCloud" : !scLogin ? "Подключите SoundCloud в настройках" : t == null ? "SoundCloud создаёт плейлист с первым треком — нажмите ⋯ у трека" : "Сюда можно только треки SoundCloud"}};
        for (final String[] w : ws) {
            final boolean enabled = "yp".equals(w[0]) || ("yt".equals(w[0]) && ytOk) || ("sc".equals(w[0]) && scOk);
            final View v = pick(null, w[1], "yt".equals(w[1]) ? Ui.YT : "cloud".equals(w[1]) ? Ui.SC : Ui.ACCENT, w[2], w[3], false, null);
            v.setAlpha(enabled ? 1f : 0.45f);
            opts.add(v); c.addView(v);
            v.setOnClickListener(x -> { if (!enabled) return; where[0] = w[0]; for (View o : opts) { GradientDrawable g = Ui.round(Ui.S2, 14); if (o == v) g.setStroke(Ui.dp(2), Ui.ACCENT); o.setBackground(g); } });
        }
        GradientDrawable g0 = Ui.round(Ui.S2, 14); g0.setStroke(Ui.dp(2), Ui.ACCENT); opts.get(0).setBackground(g0);
        final Dialog[] d = new Dialog[1];
        LinearLayout r = Ui.row(Gravity.END); r.setPadding(0, Ui.dp(6), 0, 0);
        r.addView(Ui.pill("Создать", true, () -> {
            final String name = e.getText().toString().trim(); if (name.isEmpty()) { e.requestFocus(); return; }
            d[0].dismiss();
            if ("yp".equals(where[0])) {
                JSONObject p = new JSONObject(); JSONArray items = new JSONArray(); if (t != null) items.put(t.json());
                try { p.put("id", "p" + Long.toString(System.currentTimeMillis(), 36)); p.put("name", name); p.put("items", items); } catch (Exception ignored) {}
                JSONArray all = jarr("playlists"); JSONArray n = new JSONArray(); n.put(p); for (int i = 0; i < all.length(); i++) n.put(all.optJSONObject(i));
                prefs.edit().putString("playlists", n.toString()).apply();
                toast("Плейлист «" + name + "» создан"); paintLib();
            } else if ("yt".equals(where[0])) {
                toast("Создаю плейлист в YouTube Music…");
                Engine.Cb cb = res -> { plAt = 0; toast(res.optBoolean("ok") ? "✓ «" + name + "» создан в YouTube Music" : "YouTube Music не создал плейлист"); loadRemotePlaylists(true, this::paintLib); };
                if (t != null) engine.eng("plCreate", cb, "name", name, "videoId", t.videoId, "title", t.title, "artist", t.artist); else engine.eng("plCreate", cb, "name", name);
            } else {
                toast("Создаю плейлист в SoundCloud…");
                engine.sc("create", t.url + "#name=" + enc(name), res -> { plAt = 0; toast(res.optBoolean("ok") ? "✓ «" + name + "» создан в SoundCloud" : "SoundCloud не создал плейлист"); loadRemotePlaylists(true, this::paintLib); });
            }
        }));
        c.addView(r);
        d[0] = sheet(c);
        e.requestFocus(); Ui.main.postDelayed(() -> showKeyboard(e), 150);
    }
    boolean plHas(JSONObject p, Track t) { JSONArray a = p.optJSONArray("items"); for (int i = 0; a != null && i < a.length(); i++) if (Track.from(a.optJSONObject(i), "yt").key().equals(t.key())) return true; return false; }
    void addTo(JSONObject p, Track t) { try { p.optJSONArray("items").put(t.json()); } catch (Exception ignored) {} savePlaylist(p); paintLib(); }
    void removeFromPlaylist(JSONObject p, Track t) {
        JSONArray a = p.optJSONArray("items"), n = new JSONArray();
        for (int i = 0; a != null && i < a.length(); i++) if (!Track.from(a.optJSONObject(i), "yt").key().equals(t.key())) n.put(a.optJSONObject(i));
        try { p.put("items", n); } catch (Exception ignored) {}
        savePlaylist(p); paintPlaylist(); paintLib(); toast("Убрано из плейлиста");
    }
    void savePlaylist(JSONObject p) {
        JSONArray a = jarr("playlists");
        for (int i = 0; i < a.length(); i++) if (p.optString("id").equals(a.optJSONObject(i).optString("id"))) { try { a.put(i, p); } catch (Exception ignored) {} }
        prefs.edit().putString("playlists", a.toString()).apply();
    }
    void deletePlaylist(String id) { JSONArray a = jarr("playlists"), n = new JSONArray(); for (int i = 0; i < a.length(); i++) if (!id.equals(a.optJSONObject(i).optString("id"))) n.put(a.optJSONObject(i)); prefs.edit().putString("playlists", n.toString()).apply(); paintLib(); }
    JSONArray jarr(String k) { try { return new JSONArray(prefs.getString(k, "[]")); } catch (Exception e) { return new JSONArray(); } }

    // ═════════ likes / dislikes ═════════
    void like() {
        Track t = P.cur; if (t == null) return;
        if ("yt".equals(t.src)) { engine.control("like"); toast(t.liked ? "Убрано из понравившихся" : "♥ Сохранено в YouTube Music"); t.liked = !t.liked; prefs.edit().remove("likes").apply(); paintNP(); }
        else if ("sc".equals(t.src)) likeSc(t);
        else { JSONArray f = jarr("localFav"); JSONArray n = new JSONArray(); boolean had = false; for (int i = 0; i < f.length(); i++) { if (t.id.equals(f.optString(i))) had = true; else n.put(f.optString(i)); } if (!had) n.put(t.id); prefs.edit().putString("localFav", n.toString()).apply(); paintNP(); }
    }
    boolean likedNow() {
        Track t = P.cur; if (t == null) return false;
        if ("sc".equals(t.src)) return scLiked(t.url);
        if ("local".equals(t.src)) { JSONArray f = jarr("localFav"); for (int i = 0; i < f.length(); i++) if (t.id.equals(f.optString(i))) return true; return false; }
        return t.liked;
    }
    void likeSc(final Track t) {
        final boolean liked = scLiked(t.url);
        toast(liked ? "Убираю лайк…" : "Ставлю лайк в SoundCloud…");
        engine.sc(liked ? "unlike" : "like", t.url, r -> {
            if (r.has("login") && !r.optBoolean("login")) { toast("Войдите в SoundCloud в настройках"); return; }
            if (!r.optBoolean("ok")) { toast("SoundCloud не принял лайк"); return; }
            JSONObject lc = cached("likes"); if (lc == null) lc = new JSONObject();
            JSONArray a = lc.optJSONArray("sc"), n = new JSONArray();
            if (!liked) { JSONObject o = t.json(); try { o.put("likedAt", java.time.Instant.now().toString()); } catch (Exception ignored) {} n.put(o); }
            for (int i = 0; a != null && i < a.length(); i++) if (!t.url.equals(a.optJSONObject(i).optString("url"))) n.put(a.optJSONObject(i));
            try { lc.put("sc", n); } catch (Exception ignored) {}
            prefs.edit().putString("likes", lc.toString()).apply();
            toast(liked ? "Убрано из лайков SoundCloud" : "♥ Сохранено в SoundCloud"); paintNP();
        });
    }
    boolean isDisliked(Track t) { JSONArray a = jarr("disliked"); String k = t.key(); for (int i = 0; i < a.length(); i++) if (k.equals(a.optJSONObject(i).optString("key"))) return true; return false; }
    void dislike(Track t) {
        if (t == null) return;
        JSONArray a = jarr("disliked");
        if (isDisliked(t)) { JSONArray n = new JSONArray(); for (int i = 0; i < a.length(); i++) if (!t.key().equals(a.optJSONObject(i).optString("key"))) n.put(a.optJSONObject(i)); prefs.edit().putString("disliked", n.toString()).apply(); toast("Снова можно предлагать"); paintNP(); return; }
        JSONObject o = t.json(); try { o.put("key", t.key()); } catch (Exception ignored) {}
        JSONArray n = new JSONArray(); n.put(o); for (int i = 0; i < a.length(); i++) n.put(a.optJSONObject(i));
        prefs.edit().putString("disliked", n.toString()).apply();
        boolean isCur = P.cur != null && P.cur.key().equals(t.key());
        if (isCur && "yt".equals(t.src)) engine.control("dislike");
        toast("Больше не предложу: " + t.title);
        if (isCur) P.next(false);
    }

    // ═════════ Настройки ═════════
    View settingsScreen() {
        LinearLayout c = page();
        c.addView(header(null, "Настройки"));
        c.addView(setTitle("Аккаунты"));
        boolean yIn = account.optBoolean("signedIn");
        c.addView(accRow("yt", Ui.YT, "YouTube Music", !engineReady ? "Подключаюсь…" : yIn ? "✓ Вход выполнен" : "Вход не выполнен", yIn ? "Сменить" : "Войти", this::googleLogin));
        c.addView(accRow("cloud", Ui.SC, "SoundCloud", !scChecked ? "Проверяю…" : scLogin ? "✓ " + (scUser.isEmpty() ? "Подключён" : scUser) : "Вход не выполнен", scLogin ? "Выйти" : "Войти", () -> { if (scLogin) { scLogout(); scLogin = false; showTab("settings"); } else scLoginDialog(); }));
        if (!scChecked) engine.sc("status", "", d -> { scChecked = true; scLogin = d.optBoolean("login"); scUser = d.optString("user", ""); if ("settings".equals(tab) && stack.size() == 1) showTab("settings"); });
        c.addView(setTitle("Цвет"));
        LinearLayout acc = Ui.row(Gravity.CENTER_VERTICAL);
        int[] colors = {0xFFFF5A36, 0xFFFF3D6E, 0xFFFFB020, 0xFF2BC48A, 0xFF22B8E6, 0xFF4A7DFF, 0xFF9B6BFF, 0xFFE6E1DC};
        for (final int col : colors) {
            FrameLayout b = new FrameLayout(this); GradientDrawable g = new GradientDrawable(); g.setShape(GradientDrawable.OVAL); g.setColor(col);
            if (col == Ui.ACCENT) g.setStroke(Ui.dp(3), Ui.TEXT);
            b.setBackground(g);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(Ui.dp(34), Ui.dp(34)); lp.rightMargin = Ui.dp(10);
            Ui.clickable(b, () -> { Ui.ACCENT = col; prefs.edit().putInt("accent", col).apply(); tabRoots.clear(); showTab("settings"); if (P.cur != null) paintNP(); });
            acc.addView(b, lp);
        }
        HorizontalScrollView hs = new HorizontalScrollView(this); hs.setHorizontalScrollBarEnabled(false); hs.addView(acc); c.addView(hs);
        c.addView(setTitle("Воспроизведение"));
        c.addView(toggle("autoNP", true, "Открывать плеер при запуске трека", "Полный экран с текстом и очередью"));
        c.addView(toggle("adblock", true, "Блокировка рекламы", "Реклама в YouTube Music не показывается и не звучит"));
        c.addView(setTitle("Не предлагать"));
        final int nd = jarr("disliked").length();
        c.addView(accRow("broken", Ui.MUTED, "Скрытые треки", nd == 0 ? "Пока нет" : nd + " тр. — YouPlay их пропускает", nd > 0 ? "Очистить" : null, () -> { prefs.edit().putString("disliked", "[]").apply(); showTab("settings"); toast("Список очищен"); }));
        c.addView(setTitle("Приложение"));
        updLine = Ui.text(updText(), 13.5f, Ui.MUTED, false);
        LinearLayout ur = Ui.row(Gravity.CENTER_VERTICAL); ur.setPadding(Ui.dp(14), Ui.dp(12), Ui.dp(12), Ui.dp(12)); ur.setBackground(Ui.round(Ui.SURF, 16));
        LinearLayout ut = Ui.col(); ut.addView(Ui.text("YouPlay " + BuildConfig.VERSION, 15, Ui.TEXT, true)); updLine.setPadding(0, Ui.dp(4), 0, 0); ut.addView(updLine);
        ur.addView(ut, Ui.lpw(1));
        ur.addView(Ui.pill("Проверить", false, () -> { updState = "checking"; paintUpd(); Ui.pool.execute(this::checkUpdate); }));
        c.addView(ur);
        return scroll(c);
    }
    View setTitle(String s) { TextView t = Ui.line(s.toUpperCase(), 12, Ui.MUTED, true); t.setLetterSpacing(0.1f); t.setPadding(Ui.dp(4), Ui.dp(22), 0, Ui.dp(10)); return t; }
    View accRow(String icon, int iconColor, String title, String sub, String btn, Runnable r) {
        LinearLayout b = Ui.row(Gravity.CENTER_VERTICAL); b.setPadding(Ui.dp(14), Ui.dp(12), Ui.dp(12), Ui.dp(12)); b.setBackground(Ui.round(Ui.SURF, 16));
        b.addView(Ui.icon(icon, 26, iconColor));
        LinearLayout t = Ui.col(); t.setPadding(Ui.dp(14), 0, Ui.dp(8), 0);
        t.addView(Ui.text(title, 15, Ui.TEXT, true)); TextView s = Ui.text(sub, 13, sub.startsWith("✓") ? Ui.LOCAL : Ui.MUTED, false); s.setPadding(0, Ui.dp(4), 0, 0); t.addView(s);
        b.addView(t, Ui.lpw(1));
        if (btn != null) b.addView(Ui.pill(btn, !btn.equals("Выйти") && !btn.equals("Сменить") && !btn.equals("Очистить"), r));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP); lp.bottomMargin = Ui.dp(8); b.setLayoutParams(lp);
        return b;
    }
    View toggle(final String key, boolean def, String title, String sub) {
        final boolean[] on = {prefs.getBoolean(key, def)};
        LinearLayout b = Ui.row(Gravity.CENTER_VERTICAL); b.setPadding(Ui.dp(14), Ui.dp(12), Ui.dp(14), Ui.dp(12)); b.setBackground(Ui.ripple(Ui.round(Ui.SURF, 16), true));
        LinearLayout t = Ui.col(); t.addView(Ui.text(title, 15, Ui.TEXT, true)); TextView s = Ui.text(sub, 12.5f, Ui.MUTED, false); s.setPadding(0, Ui.dp(4), 0, 0); t.addView(s);
        b.addView(t, Ui.lpw(1));
        final FrameLayout sw = new FrameLayout(this);
        final View knob = new View(this);
        final Runnable paint = () -> {
            sw.setBackground(Ui.round(on[0] ? Ui.ACCENT : Ui.S3, 14));
            GradientDrawable k = new GradientDrawable(); k.setShape(GradientDrawable.OVAL); k.setColor(Color.WHITE); knob.setBackground(k);
            knob.animate().translationX(on[0] ? Ui.dp(20) : 0).setDuration(160).start();
        };
        FrameLayout.LayoutParams kl = new FrameLayout.LayoutParams(Ui.dp(22), Ui.dp(22), Gravity.CENTER_VERTICAL); kl.leftMargin = Ui.dp(3);
        sw.addView(knob, kl); paint.run();
        b.addView(sw, new LinearLayout.LayoutParams(Ui.dp(48), Ui.dp(28)));
        Ui.clickable(b, () -> { on[0] = !on[0]; prefs.edit().putBoolean(key, on[0]).apply(); paint.run(); if ("adblock".equals(key)) engine.adblock = on[0]; });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP); lp.bottomMargin = Ui.dp(8); b.setLayoutParams(lp);
        return b;
    }

    // ═════════ sign-in ═════════
    void googleLogin() { loginDialog("https://accounts.google.com/ServiceLogin?service=youtube&continue=" + Uri.encode("https://www.youtube.com/signin?action_handle_signin=true&app=desktop&next=https%3A%2F%2Fmusic.youtube.com%2F"), "google"); }
    void scLoginDialog() { loginDialog("https://soundcloud.com/signin", "sc"); }
    void loginDialog(String url, final String service) {
        final WebView w = new WebView(this);
        Engine.setup(w); w.setBackgroundColor(Color.WHITE);
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, true);
        final Dialog d = new Dialog(this, android.R.style.Theme_DeviceDefault_NoActionBar);
        d.setContentView(w);
        final boolean[] ok = {false};
        w.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView v, String u) {
                if ("google".equals(service) && u.startsWith(Engine.YTM)) { ok[0] = true; d.dismiss(); }
                if ("sc".equals(service)) { String ck = CookieManager.getInstance().getCookie("https://soundcloud.com"); if (u.startsWith("https://soundcloud.com/") && !u.contains("/signin") && ck != null && ck.contains("oauth_token=")) { ok[0] = true; d.dismiss(); } }
            }
        });
        d.setOnDismissListener(x -> {
            CookieManager.getInstance().flush(); w.destroy();
            if (!ok[0]) { toast("Вход отменён"); return; }
            if ("google".equals(service)) { toast("Вы вошли в Google"); engineReady = false; engine.ready = false; engine.yt.loadUrl(Engine.YTM); prefs.edit().remove("likes").apply(); }
            else { toast("SoundCloud подключён"); scChecked = false; prefs.edit().remove("likes").apply(); }
            plAt = 0; if ("settings".equals(tab)) showTab("settings");
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
        JSONObject lc = cached("likes"); if (lc != null) { try { lc.put("sc", new JSONArray()); } catch (Exception ignored) {} prefs.edit().putString("likes", lc.toString()).apply(); }
    }

    // ═════════ mini player ═════════
    ImageView miniArt; TextView miniTitle, miniArtist; FrameLayout miniPlay, miniWrap; View miniBar;
    void buildMini() {
        miniWrap = new FrameLayout(this);
        mini = Ui.row(Gravity.CENTER_VERTICAL); mini.setPadding(Ui.dp(10), Ui.dp(8), Ui.dp(6), Ui.dp(8));
        mini.setBackground(Ui.ripple(Ui.round(Ui.SURF, 16), true));
        miniArt = Ui.cover(44, 9); mini.addView(miniArt);
        LinearLayout m = Ui.col(); m.setPadding(Ui.dp(12), 0, Ui.dp(6), 0);
        miniTitle = Ui.line("", 14.5f, Ui.TEXT, true); miniArtist = Ui.line("", 12.5f, Ui.MUTED, false); miniArtist.setPadding(0, Ui.dp(3), 0, 0);
        m.addView(miniTitle); m.addView(miniArtist);
        mini.addView(m, Ui.lpw(1));
        miniPlay = Ui.iconButton("play", 44, 26, Ui.TEXT, 0, () -> P.toggle()); mini.addView(miniPlay);
        mini.addView(Ui.iconButton("next", 44, 24, Ui.TEXT, 0, () -> P.next(false)));
        Ui.clickable(mini, this::openNP);
        FrameLayout.LayoutParams ml = new FrameLayout.LayoutParams(Ui.MATCH, Ui.dp(62)); ml.setMargins(Ui.dp(8), Ui.dp(4), Ui.dp(8), Ui.dp(4));
        miniWrap.addView(mini, ml);
        miniBar = new View(this); miniBar.setBackgroundColor(Ui.TEXT); miniBar.setPivotX(0); miniBar.setScaleX(0);
        FrameLayout.LayoutParams bl = new FrameLayout.LayoutParams(Ui.MATCH, Ui.dp(2), Gravity.BOTTOM); bl.setMargins(Ui.dp(22), 0, Ui.dp(22), Ui.dp(5));
        miniWrap.addView(miniBar, bl);
        miniWrap.setVisibility(View.GONE);
        appBox.addView(miniWrap, new LinearLayout.LayoutParams(Ui.MATCH, Ui.dp(70)));
    }
    void playList(List<Track> l, int i, String name) {
        if (l == null || l.isEmpty()) return;
        P.playList(l, i, name);
        if (prefs.getBoolean("autoNP", true)) openNP();
    }

    // ═════════ Now Playing ═════════
    LinearLayout npInner; boolean npOpen = false; ImageView npBg, npArt; TextView npTitle, npArtist, npSrc, npCur, npDur, npBadge; FrameLayout npPlay, npLike, npDislike, npAdd, npShuffle, npRepeat;
    SeekBar npSeek; boolean seeking = false; FrameLayout npMid; ScrollView lyScroll; LinearLayout lyList; ListView qList; String npPane = "art"; TextView tabLy, tabQ;
    void buildNowPlaying() {
        npBox = new FrameLayout(this); npBox.setBackgroundColor(Ui.BG); npBox.setClickable(true);
        npBg = new ImageView(this); npBg.setScaleType(ImageView.ScaleType.CENTER_CROP); npBg.setAlpha(0.55f);
        if (Build.VERSION.SDK_INT >= 31) npBg.setRenderEffect(RenderEffect.createBlurEffect(Ui.dp(60), Ui.dp(60), Shader.TileMode.CLAMP));
        npBox.addView(npBg, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        View shade = new View(this); shade.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[]{0x66120D0B, 0xCC120D0B, 0xF2120D0B}));
        npBox.addView(shade, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        npInner = Ui.col(); npBox.addView(npInner, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        LinearLayout top = Ui.row(Gravity.CENTER_VERTICAL);
        top.addView(Ui.iconButton("down", 44, 26, Ui.TEXT, 0, this::closeNP));
        npSrc = Ui.line("", 12, Ui.MUTED, true); npSrc.setGravity(Gravity.CENTER); npSrc.setLetterSpacing(0.12f);
        top.addView(npSrc, Ui.lpw(1));
        top.addView(Ui.iconButton("dots", 44, 22, Ui.TEXT, 0, () -> { if (P.cur != null) trackMenu(P.cur, null); }));
        npInner.addView(top);
        npMid = new FrameLayout(this);
        npArt = Ui.cover(0, 18);
        FrameLayout.LayoutParams al = new FrameLayout.LayoutParams(Ui.dp(300), Ui.dp(300), Gravity.CENTER);
        npMid.addView(npArt, al);
        npMid.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> { int s = Math.max(Ui.dp(120), Math.min(r - l, b - t - Ui.dp(36))); FrameLayout.LayoutParams p = (FrameLayout.LayoutParams) npArt.getLayoutParams(); if (p.width != s) { p.width = s; p.height = s; npArt.post(() -> npArt.setLayoutParams(p)); } });
        lyList = Ui.col(); lyList.setPadding(0, Ui.dp(140), 0, Ui.dp(220));
        lyScroll = scroll(lyList); lyScroll.setVisibility(View.GONE);
        lyScroll.setVerticalFadingEdgeEnabled(true); lyScroll.setFadingEdgeLength(Ui.dp(60));
        npMid.addView(lyScroll, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        qList = new ListView(this); qList.setDivider(null); qList.setSelector(new ColorDrawable(Color.TRANSPARENT)); qList.setVisibility(View.GONE); qList.setVerticalScrollBarEnabled(false);
        npMid.addView(qList, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        npInner.addView(npMid, new LinearLayout.LayoutParams(Ui.MATCH, 0, 1));
        LinearLayout meta = Ui.row(Gravity.CENTER_VERTICAL);
        LinearLayout mt = Ui.col();
        npTitle = Ui.line("", 22, Ui.TEXT, true); npArtist = Ui.line("", 15, Ui.MUTED, false); npArtist.setPadding(0, Ui.dp(4), 0, Ui.dp(6));
        npBadge = Ui.badge("yt");
        LinearLayout br = Ui.row(Gravity.START); br.addView(npBadge);
        mt.addView(npTitle); mt.addView(npArtist); mt.addView(br);
        meta.addView(mt, Ui.lpw(1));
        npAdd = Ui.iconButton("plus", 44, 22, Ui.TEXT, 0x22FFFFFF, () -> { if (P.cur != null) addToPlaylist(P.cur); });
        npLike = Ui.iconButton("heartLine", 44, 22, Ui.TEXT, 0x22FFFFFF, this::like);
        npDislike = Ui.iconButton("broken", 44, 22, Ui.TEXT, 0x22FFFFFF, () -> dislike(P.cur));
        for (View v : new View[]{npAdd, npLike, npDislike}) { LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(Ui.dp(44), Ui.dp(44)); lp.leftMargin = Ui.dp(8); meta.addView(v, lp); }
        npInner.addView(meta);
        npSeek = new SeekBar(this); npSeek.setMax(1000);
        npSeek.setProgressTintList(ColorStateList.valueOf(Ui.TEXT)); npSeek.setThumbTintList(ColorStateList.valueOf(Ui.TEXT)); npSeek.setProgressBackgroundTintList(ColorStateList.valueOf(0x55FFFFFF));
        npSeek.setPadding(Ui.dp(12), Ui.dp(14), Ui.dp(12), Ui.dp(8));
        npSeek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            public void onProgressChanged(SeekBar s, int p, boolean user) { if (user && P.dur > 0) npCur.setText(Ui.fmt(p / 1000.0 * P.dur)); }
            public void onStartTrackingTouch(SeekBar s) { seeking = true; }
            public void onStopTrackingTouch(SeekBar s) { seeking = false; if (P.dur > 0) { P.seek(s.getProgress() / 1000.0 * P.dur); lyLast = -2; } }
        });
        LinearLayout.LayoutParams sl = new LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP); sl.leftMargin = -Ui.dp(12); sl.rightMargin = -Ui.dp(12);
        npInner.addView(npSeek, sl);
        LinearLayout times = Ui.row(Gravity.CENTER_VERTICAL);
        npCur = Ui.line("0:00", 12, Ui.MUTED, false); npDur = Ui.line("0:00", 12, Ui.MUTED, false);
        times.addView(npCur, Ui.lpw(1)); times.addView(npDur);
        npInner.addView(times);
        LinearLayout ctl = Ui.row(Gravity.CENTER_VERTICAL); ctl.setPadding(0, Ui.dp(14), 0, Ui.dp(14));
        npShuffle = Ui.iconButton("shuffle", 48, 24, Ui.TEXT, 0, () -> { P.shuffle = !P.shuffle; toast(P.shuffle ? "Перемешивание включено" : "Перемешивание выключено"); paintNP(); });
        npPlay = Ui.iconButton("play", 72, 34, 0xFF111111, Ui.TEXT, () -> P.toggle());
        npRepeat = Ui.iconButton("repeat", 48, 24, Ui.TEXT, 0, () -> { P.repeat = (P.repeat + 1) % 3; toast(P.repeat == 0 ? "Повтор выключен" : P.repeat == 1 ? "Повтор очереди" : "Повтор трека"); paintNP(); });
        View[] cs = {npShuffle, Ui.iconButton("prev", 56, 30, Ui.TEXT, 0, () -> P.prev()), npPlay, Ui.iconButton("next", 56, 30, Ui.TEXT, 0, () -> P.next(false)), npRepeat};
        for (int i = 0; i < cs.length; i++) { ctl.addView(cs[i]); if (i < cs.length - 1) ctl.addView(new View(this), Ui.lpw(1)); }
        npInner.addView(ctl);
        LinearLayout panes = Ui.row(Gravity.CENTER);
        tabLy = paneTab("lyrics", "Текст"); tabQ = paneTab("queue", "Очередь");
        panes.addView(tabLy); panes.addView(Ui.space(10, 1)); panes.addView(tabQ);
        npInner.addView(panes);
        final float[] y0 = {-1};
        top.setOnTouchListener((v, e) -> {
            if (e.getAction() == MotionEvent.ACTION_DOWN) y0[0] = e.getRawY();
            else if (e.getAction() == MotionEvent.ACTION_MOVE && y0[0] >= 0) npBox.setTranslationY(Math.max(0, e.getRawY() - y0[0]));
            else if (e.getAction() == MotionEvent.ACTION_UP || e.getAction() == MotionEvent.ACTION_CANCEL) { if (npBox.getTranslationY() > Ui.dp(120)) closeNP(); else npBox.animate().translationY(0).setDuration(180).start(); y0[0] = -1; }
            return false;
        });
        npBox.setVisibility(View.GONE);
        root.addView(npBox, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
    }
    TextView paneTab(final String id, String label) {
        TextView t = Ui.text(label, 14, Ui.TEXT, true);
        t.setGravity(Gravity.CENTER); t.setPadding(Ui.dp(22), 0, Ui.dp(22), 0);
        t.setLayoutParams(new LinearLayout.LayoutParams(Ui.WRAP, Ui.dp(40)));
        Ui.clickable(t, () -> setPane(id.equals(npPane) ? "art" : id));
        return t;
    }
    void setPane(String p) {
        npPane = p;
        npArt.setVisibility("art".equals(p) ? View.VISIBLE : View.GONE);
        lyScroll.setVisibility("lyrics".equals(p) ? View.VISIBLE : View.GONE);
        qList.setVisibility("queue".equals(p) ? View.VISIBLE : View.GONE);
        tabLy.setBackground(Ui.ripple(Ui.round("lyrics".equals(p) ? Ui.TEXT : 0x22FFFFFF, 20), true)); tabLy.setTextColor("lyrics".equals(p) ? 0xFF111111 : Ui.TEXT);
        tabQ.setBackground(Ui.ripple(Ui.round("queue".equals(p) ? Ui.TEXT : 0x22FFFFFF, 20), true)); tabQ.setTextColor("queue".equals(p) ? 0xFF111111 : Ui.TEXT);
        if ("queue".equals(p)) paintQueue();
        lyLast = -2;
    }
    void openNP() {
        if (P.cur == null) return;
        npOpen = true; npBox.setVisibility(View.VISIBLE);
        npBox.setTranslationY(root.getHeight()); npBox.animate().translationY(0).setDuration(280).setInterpolator(new android.view.animation.DecelerateInterpolator(2f)).start();
        paintNP();
    }
    void closeNP() {
        npOpen = false;
        npBox.animate().translationY(root.getHeight()).setDuration(220).withEndAction(() -> { if (!npOpen) npBox.setVisibility(View.GONE); }).start();
    }
    void paintQueue() {
        qList.setAdapter(new Tracks(P.list, P.name, null) {
            @Override public View getView(int i, View conv, ViewGroup parent) {
                View v = super.getView(i, conv, parent);
                final int k = i; v.setOnClickListener(x -> P.playAt(k));
                v.setPadding(0, Ui.dp(7), 0, Ui.dp(7));
                return v;
            }
        });
        if (P.i >= 0) qList.setSelectionFromTop(P.i, Ui.dp(100));
    }
    void paintNP() {
        Track t = P.cur; if (t == null) return;
        npTitle.setText(t.title); npArtist.setText(t.artist);
        String b = "sc".equals(t.src) ? "SoundCloud" : "local".equals(t.src) ? "На телефоне" : "YouTube Music";
        int c = "sc".equals(t.src) ? Ui.SC : "local".equals(t.src) ? Ui.LOCAL : Ui.YT;
        npBadge.setText(b); npBadge.setTextColor(c); npBadge.setBackground(Ui.round((c & 0x00FFFFFF) | 0x2A000000, 6));
        npSrc.setText((P.name == null || P.name.isEmpty() ? "Сейчас играет" : P.name).toUpperCase());
        Ui.setIcon(Ui.iconOf(npPlay), P.playing ? "pause" : "play", 0xFF111111);
        boolean l = likedNow();
        Ui.setIcon(Ui.iconOf(npLike), l ? "heart" : "heartLine", l ? Ui.ACCENT : Ui.TEXT);
        Ui.setIcon(Ui.iconOf(npDislike), "broken", isDisliked(t) || t.disliked ? Ui.ACCENT : Ui.TEXT);
        Ui.setIcon(Ui.iconOf(npShuffle), "shuffle", P.shuffle ? Ui.ACCENT : Ui.TEXT);
        Ui.setIcon(Ui.iconOf(npRepeat), P.repeat == 2 ? "repeat1" : "repeat", P.repeat > 0 ? Ui.ACCENT : Ui.TEXT);
        setPane(npPane);
    }

    // ═════════ Player.View ═════════
    String lastArt = "", lastMedia = "", lastKey = "";
    @Override public void onTrack() {
        Track t = P.cur; if (t == null) return;
        miniWrap.setVisibility(View.VISIBLE);
        miniTitle.setText(t.title); miniArtist.setText(t.artist);
        if (!t.art.equals(lastArt)) { lastArt = t.art; Ui.load(miniArt, t.art, Ui.dp(88)); Ui.load(npArt, t.art, Ui.dp(420)); Ui.load(npBg, t.art, Ui.dp(200)); }
        if (!t.key().equals(lastKey)) {
            lastKey = t.key();
            JSONArray r = jarr("recent"), n = new JSONArray(); n.put(t.json());
            for (int i = 0; i < r.length() && n.length() < 20; i++) if (!Track.from(r.optJSONObject(i), "yt").key().equals(t.key())) n.put(r.optJSONObject(i));
            prefs.edit().putString("recent", n.toString()).apply();
            loadLyrics(t);
        }
        onState();
        if (npOpen) paintNP();
    }
    @Override public void onState() {
        if (P.cur == null) return;
        Ui.setIcon(Ui.iconOf(miniPlay), P.playing ? "pause" : "play", Ui.TEXT);
        if (npOpen) { Ui.setIcon(Ui.iconOf(npPlay), P.playing ? "pause" : "play", 0xFF111111); boolean l = likedNow(); Ui.setIcon(Ui.iconOf(npLike), l ? "heart" : "heartLine", l ? Ui.ACCENT : Ui.TEXT); }
        try {
            JSONObject m = new JSONObject(); m.put("title", P.cur.title); m.put("artist", P.cur.artist); m.put("art", P.cur.art.startsWith("http") ? P.cur.art : ""); m.put("playing", P.playing);
            String s = m.toString(); if (!s.equals(lastMedia)) { lastMedia = s; PlaybackService.update(this, s); }
        } catch (Exception ignored) {}
    }
    @Override public void onReady(JSONObject acc) {
        account = acc == null ? new JSONObject() : acc; engineReady = true;
        engine.eng("audioOnly", null, "value", true);
        if (homeBody != null && cached("home") == null) engine.eng("home", d -> { if (d.optJSONArray("sections") != null && d.optJSONArray("sections").length() > 0) { prefs.edit().putString("home", d.toString()).apply(); paintHome(d); } });
        if ("settings".equals(tab) && stack.size() == 1) showTab("settings");
    }
    final Runnable tick = new Runnable() { public void run() {
        P.tick();
        if (P.cur != null) {
            double p = P.dur > 0 ? Math.min(1, P.time / P.dur) : 0;
            miniBar.setScaleX((float) p);
            if (npOpen && !seeking) { npSeek.setProgress((int) (p * 1000)); npCur.setText(Ui.fmt(P.time)); npDur.setText(Ui.fmt(P.dur)); }
        }
        Ui.main.postDelayed(this, 250);
    } };

    // ═════════ lyrics (LRCLIB, YouTube Music fallback), word by word ═════════
    static final class Line { double t; String text; double[] ws, we; int[] wa, wb; TextView v; }
    final List<Line> ly = new ArrayList<>();
    int lyReq = 0, lyLast = -2; double lyDur = 0, smooth = 0; boolean lyTempo = false; long lyFrame = 0; String lySig = "";
    static final Pattern TEMPO = Pattern.compile("(?i)(slowed|sped|speed up|nightcore|daycore)");
    static String clean(String t) { return t.replaceAll("(?i)\\s*[(\\[][^)\\]]*(slowed|sped|reverb|nightcore|official|video|audio|lyric|mv|remaster|hd|hq|клип)[^)\\]]*[)\\]]", "").replaceAll("(?i)\\s*-\\s*(official|lyric).*$", "").trim(); }
    void lyMsg(String s) { lyList.removeAllViews(); TextView t = Ui.text(s, 17, Ui.MUTED, true); t.setGravity(Gravity.CENTER); lyList.addView(t, new LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP)); }
    void loadLyrics(final Track it) {
        final int my = ++lyReq; ly.clear(); lyLast = -2; lyDur = 0;
        lyMsg("Ищу текст…");
        if (!online || it.title.isEmpty()) { lyMsg(online ? "Текст не найден" : "Текст недоступен без интернета"); return; }
        lyTempo = TEMPO.matcher(it.title).find();
        String a = it.artist.split("•|·|,| и | & | feat\\.| ft\\.| x ")[0].replaceAll("(?i)\\s*-\\s*topic$", "").replaceAll("(?i)vevo$", "").trim();
        String t = clean(it.title);
        if (!a.isEmpty() && t.toLowerCase().startsWith(a.toLowerCase())) { String r = t.substring(a.length()).replaceAll("^\\s*[—–-]\\s*", ""); if (!r.isEmpty()) t = r; }
        final String get = "https://lrclib.net/api/get?track_name=" + enc(t) + "&artist_name=" + enc(a);
        final String s1 = "https://lrclib.net/api/search?track_name=" + enc(t) + "&artist_name=" + enc(a);
        final String s2 = "https://lrclib.net/api/search?q=" + enc(t + " " + a);
        final boolean[] net = {false};
        final Engine.Cb finish = res -> {
            if (my != lyReq) return;
            if ((res == null || (res.optString("syncedLyrics").isEmpty() && res.optString("plainLyrics").isEmpty())) && "yt".equals(it.src)) { ytLyrics(it, my, 0, net[0]); return; }
            showLyrics(res, net[0], false);
        };
        final Engine.Cb searchQ = r2 -> { if (r2.optInt("status") == 0) net[0] = true; finish.on(pickBest(r2)); };
        final Engine.Cb search1 = r1 -> { if (r1.optInt("status") == 0) net[0] = true; JSONObject best = pickBest(r1); if (best != null) finish.on(best); else Engine.fetch(s2, searchQ); };
        if (lyTempo) Engine.fetch(s1, search1);
        else Engine.fetch(get, r -> {
            if (r.optInt("status") == 0) net[0] = true;
            JSONObject o = null; try { if (r.optInt("status") == 200) o = new JSONObject(r.optString("body")); } catch (Exception ignored) {}
            if (o != null && !o.optString("syncedLyrics").isEmpty()) finish.on(o); else Engine.fetch(s1, search1);
        });
    }
    JSONObject pickBest(JSONObject r) {
        try {
            if (r.optInt("status") != 200) return null;
            JSONArray a = new JSONArray(r.optString("body"));
            JSONObject best = null; double score = -1e9;
            for (int i = 0; i < a.length(); i++) { JSONObject x = a.optJSONObject(i); double sc = (x.optString("syncedLyrics").isEmpty() ? 0 : 1000) - Math.abs(x.optDouble("duration", 0) - (P.dur > 0 ? P.dur : x.optDouble("duration", 0))); if (sc > score) { score = sc; best = x; } }
            return best;
        } catch (Exception e) { return null; }
    }
    void ytLyrics(final Track it, final int my, final int attempt, final boolean net) {
        Ui.main.postDelayed(() -> {
            if (my != lyReq || P.cur == null || !it.key().equals(P.cur.key())) return;
            engine.eng("lyrics", y -> {
                if (my != lyReq) return;
                String text = y.optString("text", "");
                if (!text.isEmpty()) { JSONObject o = new JSONObject(); try { o.put("plainLyrics", text); } catch (Exception ignored) {} showLyrics(o, net, true); }
                else if (attempt < 2) ytLyrics(it, my, attempt + 1, net);
                else showLyrics(null, net, false);
            }, "videoId", it.videoId);
        }, 1500 + attempt * 1500);
    }
    void showLyrics(JSONObject res, boolean net, boolean ytm) {
        ly.clear(); lyList.removeAllViews(); lyLast = -2;
        lyDur = res == null ? 0 : res.optDouble("duration", 0);
        String synced = res == null ? "" : res.optString("syncedLyrics", ""), plain = res == null ? "" : res.optString("plainLyrics", "");
        if (!synced.isEmpty() && !"null".equals(synced)) {
            Pattern tag = Pattern.compile("\\[(\\d+):(\\d+(?:\\.\\d+)?)\\]");
            for (String raw : synced.split("\\r?\\n")) {
                Matcher m = tag.matcher(raw); String txt = raw.replaceAll("\\[[^\\]]*\\]", "").replaceAll("<[^>]*>", "").replaceAll("\\s+", " ").trim();
                while (m.find()) { Line l = new Line(); l.t = Integer.parseInt(m.group(1)) * 60 + Double.parseDouble(m.group(2)); l.text = txt; ly.add(l); }
            }
            Collections.sort(ly, (x, y) -> Double.compare(x.t, y.t));
            for (int i = 0; i < ly.size(); i++) {
                final Line l = ly.get(i);
                double end = i + 1 < ly.size() ? Math.min(ly.get(i + 1).t, l.t + 9) : l.t + 6;
                String[] words = l.text.isEmpty() ? new String[0] : l.text.split(" ");
                l.ws = new double[words.length]; l.we = new double[words.length]; l.wa = new int[words.length]; l.wb = new int[words.length];
                double span = Math.max(0.6, (end - l.t) * 0.85), total = 0; for (String w : words) total += w.length() + 1.5;
                double at = l.t; int pos = 0;
                for (int k = 0; k < words.length; k++) { double d = span * (words[k].length() + 1.5) / Math.max(1, total); l.ws[k] = at; l.we[k] = at + d; at += d; l.wa[k] = pos; l.wb[k] = pos + words[k].length(); pos += words[k].length() + 1; }
                l.v = Ui.text(l.text.isEmpty() ? "♪" : l.text, 25, 0x55F4EEEA, true);
                l.v.setPadding(0, Ui.dp(11), Ui.dp(12), Ui.dp(11)); l.v.setLineSpacing(0, 1.12f);
                final int idx = i;
                Ui.clickable(l.v, () -> { P.seek(Math.max(0, ly.get(idx).t / ratio())); lyLast = -2; });
                lyList.addView(l.v, new LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP));
            }
        } else if (!plain.isEmpty() && !"null".equals(plain)) {
            TextView t = Ui.text(plain, 19, Ui.TEXT, true); t.setLineSpacing(0, 1.35f);
            lyList.addView(t, new LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP));
            TextView src = Ui.text(ytm ? "Текст: YouTube Music" : "Текст: LRCLIB", 12, Ui.MUTED, false); src.setPadding(0, Ui.dp(20), 0, 0); lyList.addView(src);
            lyScroll.scrollTo(0, Ui.dp(100));
        } else lyMsg(res != null && res.optBoolean("instrumental") ? "♪ Инструментал" : net ? "Нет связи с сервером текстов" : "Текст для этой песни не найден");
    }
    double ratio() { double d = P.dur; if (lyDur <= 0 || d <= 0) return 1; double k = lyDur / d; return k < .55 || k > 1.8 ? 1 : (lyTempo || Math.abs(k - 1) > .04 ? k : 1); }
    final Runnable lyFrameTick = new Runnable() { public void run() {
        Ui.main.postDelayed(this, 40);
        long now = System.currentTimeMillis(); double dt = lyFrame == 0 ? 0 : Math.min(0.1, (now - lyFrame) / 1000.0); lyFrame = now;
        if (!npOpen || !"lyrics".equals(npPane) || ly.isEmpty() || P.cur == null) return;
        if (P.playing) smooth += dt;
        if (Math.abs(smooth - P.time) > 0.3 || !P.playing) smooth = P.time;
        double t = smooth * ratio();
        int lo = 0, hi = ly.size() - 1, i = -1; double tl = t + 0.35;
        while (lo <= hi) { int m = (lo + hi) >> 1; if (ly.get(m).t <= tl) { i = m; lo = m + 1; } else hi = m - 1; }
        if (i != lyLast) {
            for (int k = 0; k < ly.size(); k++) { Line l = ly.get(k); if (k != i) { l.v.setText(l.text.isEmpty() ? "♪" : l.text); l.v.setTextColor(k < i ? 0x88F4EEEA : 0x45F4EEEA); } }
            lyLast = i; lySig = "";
            if (i >= 0) { final View v = ly.get(i).v; lyScroll.smoothScrollTo(0, Math.max(0, v.getTop() - (int) (lyScroll.getHeight() * 0.36) + v.getHeight() / 2)); }
        }
        if (i < 0) return;
        Line l = ly.get(i);
        if (l.text.isEmpty()) { l.v.setTextColor(Ui.TEXT); return; }
        double tw = t + 0.15;
        StringBuilder sig = new StringBuilder();
        int[] state = new int[l.ws.length];
        for (int k = 0; k < l.ws.length; k++) { state[k] = tw >= l.we[k] ? 100 : tw <= l.ws[k] ? 0 : (int) ((tw - l.ws[k]) / (l.we[k] - l.ws[k]) * 10) * 10; sig.append(state[k]).append(','); }
        if (sig.toString().equals(lySig)) return;
        lySig = sig.toString();
        SpannableString s = new SpannableString(l.text);
        for (int k = 0; k < state.length; k++) {
            int a = Math.round(0x50 + (0xFF - 0x50) * state[k] / 100f);
            s.setSpan(new ForegroundColorSpan((a << 24) | (Ui.TEXT & 0x00FFFFFF)), l.wa[k], Math.min(l.text.length(), l.wb[k]), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        l.v.setTextColor(Ui.TEXT);
        l.v.setText(s);
    } };

    // ═════════ toast, keyboard ═════════
    void toast(String s) {
        final TextView t = Ui.text(s, 14, Ui.TEXT, true);
        t.setPadding(Ui.dp(18), Ui.dp(13), Ui.dp(18), Ui.dp(13)); t.setBackground(Ui.round(0xF0322A26, 14)); t.setElevation(Ui.dp(6));
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(Ui.WRAP, Ui.WRAP, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL); lp.bottomMargin = insetBottom + Ui.dp(npOpen ? 40 : 150); lp.leftMargin = lp.rightMargin = Ui.dp(24);
        toastBox.removeAllViews(); toastBox.addView(t, lp);
        t.setAlpha(0f); t.setTranslationY(Ui.dp(12)); t.animate().alpha(1f).translationY(0).setDuration(180).start();
        Ui.main.postDelayed(() -> t.animate().alpha(0f).setDuration(200).withEndAction(() -> toastBox.removeView(t)).start(), 2400);
    }
    void hideKeyboard() { View f = getCurrentFocus(); if (f != null) ((InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(f.getWindowToken(), 0); }
    void showKeyboard(View v) { ((InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).showSoftInput(v, InputMethodManager.SHOW_IMPLICIT); }

    // ═════════ internet ═════════
    void watchNetwork() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            online = isOnline();
            cm.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network n) { Ui.main.postDelayed(() -> { boolean was = online; online = true; if (!was) { toast("Интернет снова есть"); if (!engine.ready) engine.yt.reload(); paintHome(cached("home")); } }, 600); }
                @Override public void onLost(Network n) { Ui.main.post(() -> { online = isOnline(); if (!online) paintHome(cached("home")); }); }
            });
        } catch (Exception ignored) {}
    }
    boolean isOnline() {
        try { ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE); Network n = cm.getActiveNetwork(); NetworkCapabilities c = n == null ? null : cm.getNetworkCapabilities(n); return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET); }
        catch (Exception e) { return true; }
    }

    // ═════════ updates (GitHub release with YouPlay-Android-<version>.apk) ═════════
    String updState = "idle", updTag = null, updUrl = null; int updPercent = 0; long updDownload = -1; TextView updLine; boolean updAsked = false;
    String updText() { switch (updState) { case "checking": return "Проверяю обновления…"; case "none": return "У вас последняя версия ✓"; case "available": return "Вышла версия " + updTag; case "downloading": return "Скачиваю… " + updPercent + "%"; case "installing": return "Устанавливаю…"; case "error": return "Не удалось проверить обновления"; default: return "Обновления проверяются при запуске"; } }
    void paintUpd() { if (updLine != null) updLine.setText(updText()); }
    void checkUpdate() {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL("https://api.github.com/repos/" + REPO + "/releases").openConnection();
            c.setRequestProperty("User-Agent", "YouPlay-Android"); c.setRequestProperty("Accept", "application/vnd.github+json");
            InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] b = new byte[16384]; int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
            JSONArray rels = new JSONArray(out.toString("UTF-8"));
            updState = "none";
            for (int i = 0; i < rels.length(); i++) {
                JSONObject r = rels.getJSONObject(i); if (r.optBoolean("draft") || r.optBoolean("prerelease")) continue;
                JSONArray as = r.optJSONArray("assets"); String apk = null;
                for (int k = 0; as != null && k < as.length(); k++) { String u = as.getJSONObject(k).optString("browser_download_url"); if (u.matches("https://.*/YouPlay-Android-[^/]*\\.apk")) apk = u; }
                if (apk == null) continue;
                String tag = r.optString("tag_name").replaceFirst("^v", "");
                if (newer(tag, BuildConfig.VERSION)) { updTag = tag; updUrl = apk; updState = "available"; }
                break;
            }
        } catch (Exception e) { updState = "error"; }
        Ui.main.post(() -> { paintUpd(); if ("available".equals(updState) && !updAsked) { updAsked = true; askUpdate(); } });
    }
    static boolean newer(String a, String b) {
        try { String[] x = a.split("\\."), y = b.split("\\."); for (int i = 0; i < Math.max(x.length, y.length); i++) { int p = i < x.length ? Integer.parseInt(x[i]) : 0, q = i < y.length ? Integer.parseInt(y[i]) : 0; if (p != q) return p > q; } }
        catch (Exception ignored) {}
        return false;
    }
    void askUpdate() {
        LinearLayout c = Ui.col();
        c.addView(Ui.icon("update", 34, Ui.ACCENT));
        TextView h = Ui.text("Вышло обновление YouPlay", 21, Ui.TEXT, true); h.setPadding(0, Ui.dp(12), 0, Ui.dp(6)); c.addView(h);
        c.addView(Ui.text("Версия " + updTag + " (у вас " + BuildConfig.VERSION + "). Вход и плейлисты сохранятся.", 14, Ui.MUTED, false));
        final Dialog[] d = new Dialog[1];
        LinearLayout r = Ui.row(Gravity.END); r.setPadding(0, Ui.dp(18), 0, 0);
        r.addView(Ui.pill("Позже", false, () -> d[0].dismiss())); r.addView(Ui.space(10, 1));
        r.addView(Ui.pill("Обновить", true, () -> { d[0].dismiss(); updateNow(); }));
        c.addView(r);
        d[0] = sheet(c);
    }
    void updateNow() {
        if (updUrl == null) return;
        final DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        updDownload = dm.enqueue(new DownloadManager.Request(Uri.parse(updUrl)).setTitle("YouPlay " + updTag).setMimeType("application/vnd.android.package-archive")
            .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, "YouPlay-" + updTag + ".apk").setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE));
        updState = "downloading"; updPercent = 0; paintUpd(); toast("Скачиваю обновление…");
        Ui.main.postDelayed(new Runnable() { public void run() {
            try (Cursor cur = dm.query(new DownloadManager.Query().setFilterById(updDownload))) {
                if (cur != null && cur.moveToFirst()) {
                    int st = cur.getInt(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                    long done = cur.getLong(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)), total = cur.getLong(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                    if (total > 0) { updPercent = (int) (done * 100 / total); paintUpd(); }
                    if (st == DownloadManager.STATUS_SUCCESSFUL) { updState = "installing"; paintUpd(); startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(dm.getUriForDownloadedFile(updDownload), "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK)); return; }
                    if (st == DownloadManager.STATUS_FAILED) { updState = "error"; paintUpd(); return; }
                }
            } catch (Exception e) { updState = "error"; paintUpd(); return; }
            Ui.main.postDelayed(this, 500);
        } }, 500);
    }

    String readAsset(String n) {
        try (InputStream in = getAssets().open(n)) { ByteArrayOutputStream o = new ByteArrayOutputStream(); byte[] b = new byte[65536]; int k; while ((k = in.read(b)) > 0) o.write(b, 0, k); return o.toString("UTF-8"); }
        catch (Exception e) { return ""; }
    }
    /** Media notification / lock screen buttons. */
    static void media(String op) { final MainActivity a = current; if (a != null) Ui.main.post(() -> a.P.cmd(op)); }
    @Override protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }
    @Override protected void onDestroy() { if (current == this) current = null; super.onDestroy(); }
}
