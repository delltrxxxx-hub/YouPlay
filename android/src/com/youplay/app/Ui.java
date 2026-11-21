package com.youplay.app;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.LruCache;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Colours, sizes, small view builders and an image loader for the native YouPlay interface. */
final class Ui {
    static Context ctx;
    static float density = 3;
    static int BG = 0xFF120D0B, SURF = 0xFF1C1512, S2 = 0xFF2A221E, S3 = 0xFF3A302B, TEXT = 0xFFF4EEEA, MUTED = 0xFFA79B94, FAINT = 0xFF6E625C;
    static int ACCENT = 0xFFFF5A36;
    static final int YT = 0xFFFF4E45, SC = 0xFFFF7A1A, LOCAL = 0xFF2BC48A;
    static final Handler main = new Handler(Looper.getMainLooper());

    static void init(Context c) { ctx = c; density = c.getResources().getDisplayMetrics().density; }
    static int dp(float v) { return Math.round(v * density); }

    static GradientDrawable round(int color, float radiusDp) { GradientDrawable g = new GradientDrawable(); g.setColor(color); g.setCornerRadius(dp(radiusDp)); return g; }
    static Drawable ripple(Drawable content, boolean bounded) {
        return new RippleDrawable(ColorStateList.valueOf(0x33FFFFFF), content, bounded ? (content != null ? content : new ColorDrawable(Color.WHITE)) : null);
    }
    static void clickable(View v, Runnable r) { v.setClickable(true); v.setFocusable(true); v.setOnClickListener(x -> r.run()); }

    static TextView text(String s, float sp, int color, boolean bold) {
        TextView t = new TextView(ctx);
        t.setText(s); t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp); t.setTextColor(color);
        t.setTypeface(Typeface.create(bold ? "sans-serif-medium" : "sans-serif", Typeface.NORMAL));
        if (bold) t.setTypeface(t.getTypeface(), Typeface.BOLD);
        t.setIncludeFontPadding(false);
        return t;
    }
    static TextView line(String s, float sp, int color, boolean bold) { TextView t = text(s, sp, color, bold); t.setSingleLine(true); t.setEllipsize(TextUtils.TruncateAt.END); return t; }

    static int iconId(String name) { return ctx.getResources().getIdentifier("i_" + name.toLowerCase(), "drawable", ctx.getPackageName()); }
    static ImageView icon(String name, int sizeDp, int color) {
        ImageView v = new ImageView(ctx);
        int id = iconId(name); if (id != 0) v.setImageResource(id);
        v.setImageTintList(ColorStateList.valueOf(color));
        v.setScaleType(ImageView.ScaleType.FIT_CENTER);
        v.setLayoutParams(new LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp)));
        return v;
    }
    static void setIcon(ImageView v, String name, int color) { int id = iconId(name); if (id != 0) v.setImageResource(id); v.setImageTintList(ColorStateList.valueOf(color)); }

    /** Round icon button: a circle with an icon in the middle. */
    static FrameLayout iconButton(String name, int boxDp, int iconDp, int iconColor, int bg, Runnable onClick) {
        FrameLayout f = new FrameLayout(ctx);
        GradientDrawable g = new GradientDrawable(); g.setShape(GradientDrawable.OVAL); g.setColor(bg);
        f.setBackground(new RippleDrawable(ColorStateList.valueOf(0x33FFFFFF), bg == 0 ? null : g, round(Color.WHITE, boxDp)));
        ImageView i = icon(name, iconDp, iconColor);
        f.addView(i, new FrameLayout.LayoutParams(dp(iconDp), dp(iconDp), Gravity.CENTER));
        f.setLayoutParams(new LinearLayout.LayoutParams(dp(boxDp), dp(boxDp)));
        f.setTag(i);
        if (onClick != null) clickable(f, onClick);
        return f;
    }
    static ImageView iconOf(View button) { return (ImageView) button.getTag(); }

    static TextView pill(String label, boolean filled, Runnable onClick) {
        TextView t = text(label, 14, filled ? 0xFF111111 : TEXT, true);
        t.setGravity(Gravity.CENTER); t.setPadding(dp(18), 0, dp(18), 0);
        t.setBackground(ripple(round(filled ? TEXT : S2, 22), true));
        t.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(42)));
        if (onClick != null) clickable(t, onClick);
        return t;
    }
    static TextView chip(String label, boolean on) {
        TextView t = text(label, 13, on ? 0xFF111111 : MUTED, true);
        t.setGravity(Gravity.CENTER); t.setPadding(dp(14), 0, dp(14), 0);
        t.setBackground(ripple(round(on ? TEXT : S2, 18), true));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(34)); lp.rightMargin = dp(8);
        t.setLayoutParams(lp);
        return t;
    }
    static TextView badge(String src) {
        String label = "sc".equals(src) ? "SoundCloud" : "local".equals(src) ? "Файл" : "YouTube";
        int c = "sc".equals(src) ? SC : "local".equals(src) ? LOCAL : YT;
        TextView t = text(label, 10.5f, c, true);
        t.setPadding(dp(7), dp(2), dp(7), dp(3));
        t.setBackground(round((c & 0x00FFFFFF) | 0x2A000000, 6));
        return t;
    }

    static ImageView cover(int sizeDp, float radiusDp) {
        ImageView v = new ImageView(ctx);
        v.setScaleType(ImageView.ScaleType.CENTER_CROP);
        v.setBackground(round(S2, radiusDp));
        clip(v, radiusDp);
        if (sizeDp > 0) v.setLayoutParams(new LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp)));
        return v;
    }
    static void clip(View v, float radiusDp) {
        final float r = dp(radiusDp);
        v.setOutlineProvider(new ViewOutlineProvider() { @Override public void getOutline(View view, Outline o) { if (r < 0) o.setOval(0, 0, view.getWidth(), view.getHeight()); else o.setRoundRect(0, 0, view.getWidth(), view.getHeight(), r); } });
        v.setClipToOutline(true);
    }
    static LinearLayout row(int gravity) { LinearLayout l = new LinearLayout(ctx); l.setOrientation(LinearLayout.HORIZONTAL); l.setGravity(gravity); return l; }
    static LinearLayout col() { LinearLayout l = new LinearLayout(ctx); l.setOrientation(LinearLayout.VERTICAL); return l; }
    static View space(int wDp, int hDp) { View v = new View(ctx); v.setLayoutParams(new LinearLayout.LayoutParams(dp(wDp), dp(hDp))); return v; }
    static LinearLayout.LayoutParams lp(int w, int h) { return new LinearLayout.LayoutParams(w, h); }
    static LinearLayout.LayoutParams lpw(float weight) { LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT); p.weight = weight; return p; }
    static final int MATCH = ViewGroup.LayoutParams.MATCH_PARENT, WRAP = ViewGroup.LayoutParams.WRAP_CONTENT;

    static String fmt(double s) { if (!(s > 0)) s = 0; int t = (int) Math.floor(s); return (t / 60) + ":" + String.format("%02d", t % 60); }

    // ── images ──
    static final LruCache<String, Bitmap> cache = new LruCache<String, Bitmap>((int) Math.min(Runtime.getRuntime().maxMemory() / 6, 64L * 1024 * 1024)) {
        @Override protected int sizeOf(String k, Bitmap b) { return b.getByteCount(); }
    };
    static final ExecutorService pool = Executors.newFixedThreadPool(4);
    static void load(final ImageView v, final String url, final int targetPx) {
        v.setTag(R_TAG, url);
        if (url == null || url.isEmpty()) { v.setImageDrawable(null); return; }
        Bitmap b = cache.get(url);
        if (b != null) { v.setImageBitmap(b); return; }
        v.setImageDrawable(null);
        pool.execute(() -> {
            Bitmap bm = fetchBitmap(url, targetPx);
            if (bm != null) cache.put(url, bm);
            main.post(() -> { if (url.equals(v.getTag(R_TAG)) && bm != null) { v.setAlpha(0f); v.setImageBitmap(bm); v.animate().alpha(1f).setDuration(160).start(); } });
        });
    }
    static final int R_TAG = 0x7f0f0001;
    static Bitmap fetchBitmap(String url, int targetPx) {
        try {
            byte[] data;
            if (url.startsWith("content://") || url.startsWith("art:")) {
                return MainActivity.current != null ? MainActivity.current.albumArt(url, targetPx) : null;
            }
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(10000); c.setReadTimeout(15000);
            try (InputStream in = c.getInputStream()) { ByteArrayOutputStream o = new ByteArrayOutputStream(); byte[] buf = new byte[16384]; int n; while ((n = in.read(buf)) > 0) o.write(buf, 0, n); data = o.toByteArray(); }
            BitmapFactory.Options op = new BitmapFactory.Options(); op.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(data, 0, data.length, op);
            int s = 1; while (op.outWidth / (s * 2) >= targetPx && op.outHeight / (s * 2) >= targetPx) s *= 2;
            BitmapFactory.Options o2 = new BitmapFactory.Options(); o2.inSampleSize = s;
            return BitmapFactory.decodeByteArray(data, 0, data.length, o2);
        } catch (Exception e) { return null; }
    }
}
