package com.youplay.app;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** One track (or a card that opens a page) from YouTube Music, SoundCloud or a file on the phone. */
final class Track {
    String src = "yt", kind = "song", videoId, url, id, title = "", artist = "", art = "", durText = "", browse, likedAt;
    double duration;
    boolean liked, disliked, round;

    String key() { return "sc".equals(src) ? "sc:" + url : "local".equals(src) ? "local:" + id : "yt:" + videoId; }
    boolean playable() { return ("yt".equals(src) && videoId != null && !videoId.isEmpty()) || ("sc".equals(src) && url != null) || ("local".equals(src) && id != null); }

    static String s(JSONObject o, String k) { return o.isNull(k) ? null : o.optString(k, null); }
    static Track from(JSONObject o, String defSrc) {
        Track t = new Track();
        t.src = o.optString("src", defSrc);
        t.kind = o.optString("kind", "song");
        t.videoId = s(o, "videoId"); t.url = s(o, "url"); t.id = s(o, "id");
        t.title = o.optString("title", ""); t.artist = o.optString("artist", "").replaceFirst("(?iu)^\\s*(композиция|песня|трек|song|track|видео|video|клип|сингл|single|ep|альбом|album|плейлист|playlist)\\s*[•·]\\s*", ""); t.art = o.optString("art", "");
        t.durText = o.optString("durText", ""); t.browse = s(o, "browse"); t.likedAt = s(o, "likedAt");
        t.duration = o.optDouble("duration", 0); if (Double.isNaN(t.duration)) t.duration = 0;
        if (t.duration > 100000) t.duration /= 1000;
        t.round = o.optBoolean("round", false);
        return t;
    }
    static List<Track> list(JSONArray a, String defSrc) {
        List<Track> out = new ArrayList<>();
        if (a == null) return out;
        for (int i = 0; i < a.length(); i++) { JSONObject o = a.optJSONObject(i); if (o != null) out.add(from(o, defSrc)); }
        return out;
    }
    JSONObject json() {
        JSONObject o = new JSONObject();
        try {
            o.put("src", src); o.put("kind", kind); o.put("videoId", videoId); o.put("url", url); o.put("id", id);
            o.put("title", title); o.put("artist", artist); o.put("art", art); o.put("durText", durText); o.put("duration", duration);
            if (likedAt != null) o.put("likedAt", likedAt);
        } catch (Exception ignored) {}
        return o;
    }
    static JSONArray json(List<Track> l) { JSONArray a = new JSONArray(); for (Track t : l) a.put(t.json()); return a; }
    Track copy() { return from(json(), src); }
}
