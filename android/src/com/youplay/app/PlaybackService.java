package com.youplay.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;

import org.json.JSONObject;

import java.io.InputStream;
import java.net.URL;

/** Keeps YouPlay playing in the background and shows the media notification / lock-screen controls. */
public class PlaybackService extends Service {
    static final String CH = "playback";
    static final int ID = 7;
    static String title = "", artist = "", art = "", lastArt = "";
    static boolean playing = false;
    static Bitmap cover;
    MediaSession session;

    /** Called with the JSON the page sends: {title, artist, art, playing, src}. */
    static void update(Context c, String json) {
        try {
            JSONObject o = new JSONObject(json);
            title = o.optString("title"); artist = o.optString("artist"); art = o.optString("art"); playing = o.optBoolean("playing");
            Intent i = new Intent(c, PlaybackService.class).setAction("update");
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (Exception ignored) {}
    }

    @Override public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel ch = new NotificationChannel(CH, "Воспроизведение", NotificationManager.IMPORTANCE_LOW);
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
        session = new MediaSession(this, "YouPlay");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { MainActivity.media("play"); }
            @Override public void onPause() { MainActivity.media("pause"); }
            @Override public void onSkipToNext() { MainActivity.media("next"); }
            @Override public void onSkipToPrevious() { MainActivity.media("prev"); }
            @Override public void onStop() { MainActivity.media("pause"); }
        });
        session.setActive(true);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent == null ? null : intent.getAction();
        if ("toggle".equals(a) || "next".equals(a) || "prev".equals(a)) MainActivity.media(a);
        if (!art.isEmpty() && !art.equals(lastArt)) {
            final String url = art; lastArt = art;
            new Thread(() -> {
                try (InputStream in = new URL(url).openStream()) { cover = BitmapFactory.decodeStream(in); } catch (Exception e) { cover = null; }
                show();
            }).start();
        }
        show();
        return START_NOT_STICKY;
    }

    PendingIntent action(String a, int req) {
        return PendingIntent.getService(this, req, new Intent(this, PlaybackService.class).setAction(a), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    synchronized void show() {
        session.setMetadata(new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, cover)
            .build());
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
            .build());
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = new Notification.Builder(this, CH)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(title.isEmpty() ? "YouPlay" : title)
            .setContentText(artist)
            .setLargeIcon(cover)
            .setContentIntent(open)
            .setOngoing(playing)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .addAction(new Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_prev), "Назад", action("prev", 1)).build())
            .addAction(new Notification.Action.Builder(Icon.createWithResource(this, playing ? R.drawable.ic_pause : R.drawable.ic_play), playing ? "Пауза" : "Играть", action("toggle", 2)).build())
            .addAction(new Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_next), "Далее", action("next", 3)).build())
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        Notification n = b.build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(ID, n);
        if (!playing) stopForeground(STOP_FOREGROUND_DETACH);   // paused: the notification stays but can be swiped away
    }

    @Override public IBinder onBind(Intent i) { return null; }
    @Override public void onDestroy() { session.release(); super.onDestroy(); }
}
