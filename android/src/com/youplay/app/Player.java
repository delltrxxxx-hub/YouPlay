package com.youplay.app;

import android.content.ContentUris;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.Uri;
import android.provider.MediaStore;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** One queue for YouTube Music (hidden page), SoundCloud (widget) and files (MediaPlayer). */
final class Player implements Engine.Listener {
    interface View { void onTrack(); void onState(); void onReady(JSONObject account); }

    final Context ctx; Engine engine; View view;
    List<Track> list = new ArrayList<>();
    int i = -1; String name = "";
    Track cur;
    boolean playing, shuffle, radio;
    int repeat = 0;   // 0 off, 1 all, 2 one
    double time, dur;
    MediaPlayer mp;
    long scTick = 0, lastPlay = 0;

    Player(Context c) { ctx = c; }

    void playList(List<Track> l, int at, String n) {
        if (l == null || l.isEmpty()) return;
        list = new ArrayList<>(); for (Track t : l) if (t.playable()) list.add(t.copy());
        if (list.isEmpty()) return;
        Track want = at >= 0 && at < l.size() ? l.get(at) : null;
        int k = 0; if (want != null) for (int j = 0; j < list.size(); j++) if (list.get(j).key().equals(want.key())) { k = j; break; }
        name = n == null ? "" : n; radio = false;
        if (shuffle) { Track first = list.remove(k); Collections.shuffle(list); list.add(0, first); k = 0; }
        playAt(k);
    }
    void addNext(Track t) { if (cur == null) { List<Track> l = new ArrayList<>(); l.add(t); playList(l, 0, "Очередь"); return; } list.add(i + 1, t.copy()); }
    void playAt(int k) {
        if (k < 0 || k >= list.size()) return;
        Track t = list.get(k);
        if (MainActivity.current != null && MainActivity.current.isDisliked(t)) { if (k + 1 < list.size()) playAt(k + 1); return; }
        stopAll(t.src);
        i = k; cur = t; time = 0; dur = t.duration; playing = true; lastPlay = System.currentTimeMillis();
        if ("yt".equals(t.src)) { engine.control("expectEnd", "value", true); engine.eng("play", null, "videoId", t.videoId); }
        else if ("sc".equals(t.src)) engine.scLoad(t.url);
        else playLocal(t);
        if (view != null) view.onTrack();
    }
    void stopAll(String except) {
        if (!"local".equals(except) && mp != null) { try { mp.stop(); } catch (Exception ignored) {} mp.release(); mp = null; }
        if (!"sc".equals(except) && cur != null && "sc".equals(cur.src)) engine.scCmd("pause");
        if (!"yt".equals(except) && cur != null && "yt".equals(cur.src)) engine.control("pause");
    }
    void playLocal(Track t) {
        try {
            if (mp != null) { mp.release(); mp = null; }
            mp = new MediaPlayer();
            mp.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
            mp.setDataSource(ctx, ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, Long.parseLong(t.id)));
            mp.setOnPreparedListener(p -> { p.start(); playing = true; dur = p.getDuration() / 1000.0; changed(); });
            mp.setOnCompletionListener(p -> next(true));
            mp.setOnErrorListener((p, a, b) -> { Ui.main.postDelayed(() -> next(true), 400); return true; });
            mp.prepareAsync();
        } catch (Exception e) { Ui.main.postDelayed(() -> next(true), 400); }
    }
    void next(boolean auto) {
        if (repeat == 2 && auto) { seek(0); resume(); return; }
        if (i + 1 < list.size()) playAt(i + 1);
        else if (repeat == 1 && !list.isEmpty()) playAt(0);
        else if (cur != null && "yt".equals(cur.src)) { engine.control("expectEnd", "value", false); engine.control("next"); radio = true; }
        else pause();
    }
    void prev() { if (time > 3) seek(0); else if (i > 0) playAt(i - 1); else seek(0); }
    void toggle() { if (playing) pause(); else resume(); }
    void pause() {
        if (cur == null) return;
        if ("yt".equals(cur.src)) engine.control("pause"); else if ("sc".equals(cur.src)) engine.scCmd("pause"); else if (mp != null) mp.pause();
        playing = false; changed();
    }
    void resume() {
        if (cur == null) return;
        if ("yt".equals(cur.src)) engine.control("play"); else if ("sc".equals(cur.src)) engine.scCmd("play"); else if (mp != null) mp.start();
        playing = true; changed();
    }
    void seek(double t) {
        if (cur == null) return; time = t;
        if ("yt".equals(cur.src)) engine.control("seek", "time", t); else if ("sc".equals(cur.src)) engine.scCmd("seekTo", t * 1000); else if (mp != null) mp.seekTo((int) (t * 1000));
        changed();
    }
    void cmd(String op) { if ("toggle".equals(op)) toggle(); else if ("play".equals(op)) resume(); else if ("pause".equals(op)) pause(); else if ("next".equals(op)) next(false); else if ("prev".equals(op)) prev(); }
    void changed() { if (view != null) view.onState(); }

    /** Called 4× a second by the activity: keeps file/SoundCloud time moving. */
    void tick() {
        if (cur == null) return;
        if ("local".equals(cur.src) && mp != null) { try { time = mp.getCurrentPosition() / 1000.0; } catch (Exception ignored) {} }
        if ("sc".equals(cur.src) && playing) { long now = System.currentTimeMillis(); if (scTick > 0) time += (now - scTick) / 1000.0; scTick = now; } else scTick = 0;
    }

    // ── engine events ──
    @Override public void onState(JSONObject s) {
        String vid = s.optString("videoId");
        if (cur == null || !"yt".equals(cur.src)) {
            if (radio && !vid.isEmpty() && s.optBoolean("playing")) adoptRadio(s); else return;
        }
        if (radio && !vid.isEmpty() && !vid.equals(cur.videoId) && !s.optString("title").isEmpty()) adoptRadio(s);
        if (!vid.isEmpty() && !vid.equals(cur.videoId)) {
            // YouTube Music moved on by itself (autoplay / repeat): follow what really plays
            if (!radio && System.currentTimeMillis() - lastPlay < 6000) return;
            int k = -1; for (int j = 0; j < list.size(); j++) if ("yt".equals(list.get(j).src) && vid.equals(list.get(j).videoId)) { k = j; break; }
            if (k >= 0) { i = k; cur = list.get(k); if (view != null) view.onTrack(); }
            else if (!radio && i + 1 < list.size()) { playAt(i + 1); return; }
            else if (!s.optString("title").isEmpty()) adoptRadio(s);
            else return;
        }
        playing = s.optBoolean("playing"); time = s.optDouble("time", 0); double d = s.optDouble("dur", 0); if (d > 0) dur = d;
        if (cur.art.isEmpty()) cur.art = s.optString("art", "");
        if (cur.title.isEmpty()) cur.title = s.optString("title", "");
        boolean likeChanged = cur.liked != s.optBoolean("liked") || cur.disliked != s.optBoolean("disliked");
        cur.liked = s.optBoolean("liked"); cur.disliked = s.optBoolean("disliked");
        if (likeChanged && view != null) view.onTrack(); else changed();
    }
    void adoptRadio(JSONObject s) {
        Track t = new Track(); t.src = "yt"; t.videoId = s.optString("videoId"); t.title = s.optString("title"); t.artist = s.optString("artist"); t.art = s.optString("art");
        list.add(t); i = list.size() - 1; cur = t;
        if (view != null) view.onTrack();
    }
    @Override public void onEnded(String videoId) { if (cur != null && "yt".equals(cur.src) && videoId.equals(cur.videoId)) next(true); }
    @Override public void onReady(JSONObject account) { if (view != null) view.onReady(account); }
    @Override public void onSc(JSONObject ev) {
        if (cur == null || !"sc".equals(cur.src)) return;
        String e = ev.optString("ev");
        if ("play".equals(e)) { playing = true; changed(); }
        else if ("pause".equals(e)) { playing = false; changed(); }
        else if ("progress".equals(e)) { time = ev.optDouble("pos", time); scTick = System.currentTimeMillis(); if (!playing) { playing = true; changed(); } }
        else if ("sound".equals(e)) { double d = ev.optDouble("dur", 0); if (d > 0) dur = d; String a = ev.optString("art", ""); if (cur.art.isEmpty() && !a.isEmpty()) { cur.art = a.replace("-large.", "-t500x500."); if (view != null) view.onTrack(); } }
        else if ("finish".equals(e)) next(true);
        else if ("error".equals(e)) Ui.main.postDelayed(() -> next(true), 500);
    }
    static Uri unused() { return null; }
}
