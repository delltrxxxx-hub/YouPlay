using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;

namespace YouPlay
{
    /// <summary>Colours, fonts and small native building blocks of the YouPlay interface.</summary>
    static class Ui
    {
        public static Color BG = C(0x120D0B), SURF = C(0x1C1512), S2 = C(0x2A221E), S3 = C(0x3A302B), TEXT = C(0xF4EEEA), MUTED = C(0xA79B94), FAINT = C(0x6E625C);
        public static Color YT = C(0xFF4E45), SC = C(0xFF7A1A), LOCAL = C(0x2BC48A);
        public static Color Accent = C(0xFF5A36);
        public static FontFamily Font = new FontFamily("Segoe UI Variable Text, Segoe UI");
        public static FontFamily Display = new FontFamily("Segoe UI Variable Display, Segoe UI");
        // theme shape: corner scale (Holo: square), filled buttons, selected navigation
        public static double Round = 1; public static bool Square;
        public static Color Fill = C(0xF4EEEA), OnFill = C(0x111111), NavOn = C(0x2A221E);
        public static CornerRadius CR(double r) { return new CornerRadius(Square ? Math.Min(r, 3) : r * Round); }
        public static Color C(int rgb) { return Color.FromRgb((byte)(rgb >> 16), (byte)(rgb >> 8), (byte)rgb); }
        public static Color A(Color c, byte a) { return Color.FromArgb(a, c.R, c.G, c.B); }
        public static SolidColorBrush Br(Color c) { var b = new SolidColorBrush(c); return b; }
        public static Color SrcColor(string src) { return src == "sc" ? SC : src == "local" ? LOCAL : YT; }

        public static TextBlock Text(string s, double size, Color c, bool bold = false, bool display = false)
        {
            return new TextBlock { Text = s ?? "", FontSize = size, Foreground = Br(c), FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal, FontFamily = display ? Display : Font, TextTrimming = TextTrimming.CharacterEllipsis, TextWrapping = TextWrapping.NoWrap };
        }
        public static TextBlock Wrap(string s, double size, Color c, bool bold = false)
        {
            var t = Text(s, size, c, bold); t.TextWrapping = TextWrapping.Wrap; t.TextTrimming = TextTrimming.None; return t;
        }

        // ── icons: the YouPlay glyph set as vector paths ──
        public static FrameworkElement Icon(string name, double size, Color c)
        {
            string[] d; var canvas = new Canvas { Width = 24, Height = 24 };
            if (Icons.D.TryGetValue(name, out d))
            {
                Geometry g = null; try { g = Geometry.Parse(d[1]); } catch { }
                var p = new Path { Data = g, SnapsToDevicePixels = false };
                if (d[0] == "f") p.Fill = Br(c);
                else { p.Stroke = Br(c); p.StrokeThickness = 2; p.StrokeStartLineCap = PenLineCap.Round; p.StrokeEndLineCap = PenLineCap.Round; p.StrokeLineJoin = PenLineJoin.Round; }
                canvas.Children.Add(p);
            }
            return new Viewbox { Width = size, Height = size, Child = canvas, Tag = name, IsHitTestVisible = false };
        }
        public static void Recolor(FrameworkElement icon, Color c)
        {
            var vb = icon as Viewbox; if (vb == null) return;
            var cv = vb.Child as Canvas; if (cv == null || cv.Children.Count == 0) return;
            var p = (Path)cv.Children[0]; if (p.Fill != null) p.Fill = Br(c); if (p.Stroke != null) p.Stroke = Br(c);
        }

        // ── clickable surfaces with a soft hover / press animation ──
        public static T Click<T>(T el, Action onClick, Color hover) where T : Border
        {
            var baseBg = el.Background as SolidColorBrush;
            Color from = baseBg != null ? baseBg.Color : Colors.Transparent;
            var bg = new SolidColorBrush(from); el.Background = bg;
            el.Cursor = Cursors.Hand;
            el.MouseEnter += (s, e) => bg.BeginAnimation(SolidColorBrush.ColorProperty, new ColorAnimation(hover, TimeSpan.FromMilliseconds(140)));
            el.MouseLeave += (s, e) => { bg.BeginAnimation(SolidColorBrush.ColorProperty, new ColorAnimation(from, TimeSpan.FromMilliseconds(200))); Press(el, 1); };
            el.MouseLeftButtonDown += (s, e) => { Press(el, 0.96); e.Handled = true; };
            el.MouseLeftButtonUp += (s, e) => { Press(el, 1); if (onClick != null) onClick(); e.Handled = true; };
            return el;
        }
        static void Press(FrameworkElement el, double to)
        {
            var st = el.RenderTransform as ScaleTransform;
            if (st == null) { st = new ScaleTransform(1, 1); el.RenderTransform = st; el.RenderTransformOrigin = new Point(0.5, 0.5); }
            var a = new DoubleAnimation(to, TimeSpan.FromMilliseconds(to < 1 ? 70 : 160)) { EasingFunction = new QuadraticEase() };
            st.BeginAnimation(ScaleTransform.ScaleXProperty, a); st.BeginAnimation(ScaleTransform.ScaleYProperty, a);
        }
        /// <summary>Round icon button.</summary>
        public static Border IconButton(string icon, double box, double iconSize, Color iconColor, Color bg, Action onClick, string tip = null)
        {
            var b = new Border { Width = box, Height = box, CornerRadius = Ui.CR(box / 2), Background = Br(bg), Child = Icon(icon, iconSize, iconColor), ToolTip = tip };
            var hover = bg.A == 0 ? A(Colors.White, 0x1A) : Lighten(bg, 0.12);
            return Click(b, onClick, hover);
        }
        public static FrameworkElement IconOf(Border b) { return b.Child as FrameworkElement; }
        public static void SetIcon(Border b, string icon, Color c) { var size = ((FrameworkElement)b.Child).Width; b.Child = Icon(icon, size, c); }
        public static Color Lighten(Color c, double k) { return Color.FromArgb(c.A, (byte)(c.R + (255 - c.R) * k), (byte)(c.G + (255 - c.G) * k), (byte)(c.B + (255 - c.B) * k)); }
        public static Color Darken(Color c, double k) { return Color.FromArgb(c.A, (byte)(c.R * (1 - k)), (byte)(c.G * (1 - k)), (byte)(c.B * (1 - k))); }

        public static Border Pill(string label, bool filled, Action onClick, string icon = null)
        {
            var sp = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            Color fg = filled ? OnFill : TEXT;
            if (icon != null) { var ic = Icon(icon, 17, fg); ic.Margin = new Thickness(0, 0, label == null ? 0 : 8, 0); sp.Children.Add(ic); }
            if (label != null) sp.Children.Add(Text(label, 13.5, fg, true));
            var b = new Border { Height = 40, Padding = new Thickness(label == null ? 11 : 18, 0, label == null ? 11 : 18, 0), CornerRadius = Ui.CR(20), Background = Br(filled ? Fill : S2), Child = sp };
            return Click(b, onClick, filled ? Lighten(Fill, 0.15) : S3);
        }
        public static Border Chip(string label, bool on, Action onClick)
        {
            var b = new Border { Height = 32, Padding = new Thickness(14, 0, 14, 0), CornerRadius = Ui.CR(16), Background = Br(on ? Fill : S2), Margin = new Thickness(0, 0, 8, 0), Child = Text(label, 12.5, on ? OnFill : MUTED, true) };
            ((TextBlock)b.Child).VerticalAlignment = VerticalAlignment.Center;
            return Click(b, onClick, on ? Fill : S3);
        }
        public static Border Badge(string src, string kind = null)
        {
            var c = SrcColor(src);
            string label = src == "sc" ? "SoundCloud" : src == "local" ? "Файл" : kind == "video" ? "Клип" : "YouTube";
            return new Border { CornerRadius = Ui.CR(5), Background = Br(A(c, 0x30)), Padding = new Thickness(6, 1, 6, 2), VerticalAlignment = VerticalAlignment.Center, Child = Text(label, 10.5, c, true) };
        }

        // ── images ──
        // ── images: the right size for each place, many at once, kept on disk, no letterbox bars ──
        static readonly Dictionary<string, BitmapSource> mem = new Dictionary<string, BitmapSource>();
        static readonly System.Runtime.CompilerServices.ConditionalWeakTable<Border, string> want = new System.Runtime.CompilerServices.ConditionalWeakTable<Border, string>();
        static readonly System.Threading.SemaphoreSlim gate = new System.Threading.SemaphoreSlim(12);
        static readonly string imgDir = System.IO.Path.Combine(Program.Data, "cache", "img");
        public static double Dpi = 1;
        public static Border Cover(string url, double w, double h, double radius, string fallbackIcon = "music")
        {
            var b = new Border { Width = w, Height = h, CornerRadius = Ui.CR(radius), Background = Br(S2), ClipToBounds = true };
            Load(b, url, (int)Math.Max(w, h), fallbackIcon);
            return b;
        }
        /// <summary>The same picture at the size needed here (small for lists, large for the player).</summary>
        static string[] Sized(string url, int w)
        {
            var m = System.Text.RegularExpressions.Regex.Match(url, @"i\.ytimg\.com/vi(?:_webp)?/([\w-]+)/");
            if (m.Success)
            {
                var id = m.Groups[1].Value; var root = "https://i.ytimg.com/vi/" + id + "/";
                return w > 160 ? new[] { root + "maxresdefault.jpg", root + "hq720.jpg", root + "sddefault.jpg", root + "hqdefault.jpg" } : new[] { root + "hq720.jpg", root + "mqdefault.jpg", root + "hqdefault.jpg" };
            }
            if (url.Contains("googleusercontent.com") || url.Contains("ggpht.com"))
            {
                int sz = Math.Max(120, Math.Min(1200, w));
                var u = System.Text.RegularExpressions.Regex.IsMatch(url, @"=w\d+-h\d+") ? System.Text.RegularExpressions.Regex.Replace(url, @"=w\d+-h\d+[^&?]*", "=w" + sz + "-h" + sz + "-l90-rj")
                      : System.Text.RegularExpressions.Regex.IsMatch(url, @"=s\d+") ? System.Text.RegularExpressions.Regex.Replace(url, @"=s\d+[^&?]*", "=s" + sz) : url;
                return new[] { u, url };
            }
            if (url.Contains("sndcdn.com"))
            {
                var u = System.Text.RegularExpressions.Regex.Replace(url, @"-(large|t\d+x\d+|small|badge|tiny|mini|crop|original)\.", w > 300 ? "-t500x500." : "-t300x300.");
                return new[] { u, url };
            }
            return new[] { url };
        }
        public static void Load(Border b, string url, int px, string fallbackIcon = "music")
        {
            if (string.IsNullOrEmpty(url) || !url.StartsWith("http")) { b.Background = Br(S2); if (fallbackIcon != null) b.Child = new Border { Child = Icon(fallbackIcon, Math.Max(16, b.Width * 0.38), FAINT), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center }; return; }
            b.Child = null;
            int w = Math.Max(64, (int)(px * Dpi * 1.15));
            int bucket = w <= 140 ? 140 : w <= 300 ? 300 : w <= 600 ? 600 : 1200;
            var key = url + "|" + bucket;
            want.Remove(b); want.Add(b, key);
            BitmapSource hit;
            lock (mem) mem.TryGetValue(key, out hit);
            if (hit != null) { b.Background = new ImageBrush(hit) { Stretch = Stretch.UniformToFill }; return; }
            b.Background = Br(S2);
            var disp = b.Dispatcher;
            System.Threading.Tasks.Task.Run(() =>
            {
                var bmp = Fetch(Sized(url, bucket), bucket);
                if (bmp == null) return;
                lock (mem) { if (mem.Count > 700) mem.Clear(); mem[key] = bmp; }
                disp.BeginInvoke((Action)(() =>
                {
                    string cur; if (!want.TryGetValue(b, out cur) || cur != key) return;
                    b.Background = new ImageBrush(bmp) { Stretch = Stretch.UniformToFill };
                    b.Opacity = 0; b.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(1, TimeSpan.FromMilliseconds(180)));
                }));
            });
        }
        static BitmapSource Fetch(string[] urls, int w)
        {
            gate.Wait();
            try
            {
                foreach (var u in urls)
                {
                    byte[] data = null;
                    var file = System.IO.Path.Combine(imgDir, Hash(u) + ".img");
                    try { if (System.IO.File.Exists(file)) data = System.IO.File.ReadAllBytes(file); } catch { }
                    if (data == null)
                    {
                        try
                        {
                            using (var wc = new System.Net.WebClient()) { wc.Headers.Add("User-Agent", "YouPlay/" + Program.Version); data = wc.DownloadData(u); }
                            if (data.Length < 1500 && u.Contains("ytimg.com")) data = null;   // YouTube's grey "no picture" placeholder
                            if (data != null) { try { System.IO.Directory.CreateDirectory(imgDir); System.IO.File.WriteAllBytes(file, data); } catch { } }
                        }
                        catch { data = null; }
                    }
                    if (data == null) continue;
                    try
                    {
                        var bi = new BitmapImage();
                        bi.BeginInit(); bi.StreamSource = new System.IO.MemoryStream(data); bi.CacheOption = BitmapCacheOption.OnLoad; bi.CreateOptions = BitmapCreateOptions.IgnoreColorProfile;
                        if (!u.Contains("ytimg.com")) bi.DecodePixelWidth = w;   // video frames are cropped first, then shown
                        bi.EndInit(); bi.Freeze();
                        BitmapSource res = u.Contains("ytimg.com") ? SquareCrop(bi) : bi;
                        if (!res.IsFrozen) res.Freeze();
                        return res;
                    }
                    catch { }
                }
                return null;
            }
            finally { gate.Release(); }
        }
        static string Hash(string s) { using (var h = System.Security.Cryptography.SHA1.Create()) return BitConverter.ToString(h.ComputeHash(System.Text.Encoding.UTF8.GetBytes(s))).Replace("-", "").ToLowerInvariant(); }
        /// <summary>Video thumbnails: cut off black / flat bars around the picture, then take the centre square.</summary>
        static BitmapSource SquareCrop(BitmapSource src)
        {
            try
            {
                var conv = new FormatConvertedBitmap(src, PixelFormats.Bgra32, null, 0);
                int W = conv.PixelWidth, H = conv.PixelHeight, stride = W * 4;
                var px = new byte[stride * H]; conv.CopyPixels(px, stride, 0);
                Func<int, int, int> lum = (x, y) => { int i = y * stride + x * 4; return (px[i] * 11 + px[i + 1] * 59 + px[i + 2] * 30) / 100; };
                Func<int, bool, bool> flat = (k, row) =>
                {
                    int n = row ? W : H, step = Math.Max(1, n / 48), first = row ? lum(0, k) : lum(k, 0), lo = 255, hi = 0;
                    for (int j = 0; j < n; j += step) { int v = row ? lum(j, k) : lum(k, j); if (v < lo) lo = v; if (v > hi) hi = v; }
                    return hi - lo < 18;   // a bar is one flat colour across
                };
                int top = 0, bottom = H - 1, left = 0, right = W - 1;
                while (top < H / 3 && flat(top, true)) top++;
                while (bottom > H * 2 / 3 && flat(bottom, true)) bottom--;
                while (left < W / 3 && flat(left, false)) left++;
                while (right > W * 2 / 3 && flat(right, false)) right--;
                int cw = right - left + 1, ch = bottom - top + 1, side = Math.Min(cw, ch);
                if (side < 40) return src;
                int x0 = left + (cw - side) / 2, y0 = top + (ch - side) / 2;
                var crop = new CroppedBitmap(src, new Int32Rect(x0, y0, side, side)); crop.Freeze();
                return crop;
            }
            catch { return src; }
        }

        // ── smooth scrolling ──
        public static ScrollViewer Scroll(UIElement content, bool horizontal = false)
        {
            var sv = new ScrollViewer { Content = content, VerticalScrollBarVisibility = horizontal ? ScrollBarVisibility.Disabled : ScrollBarVisibility.Hidden, HorizontalScrollBarVisibility = horizontal ? ScrollBarVisibility.Hidden : ScrollBarVisibility.Disabled, Focusable = false, PanningMode = horizontal ? PanningMode.HorizontalOnly : PanningMode.VerticalOnly };
            double target = 0; bool running = false;
            EventHandler step = null;
            step = (s, e) =>
            {
                double cur = horizontal ? sv.HorizontalOffset : sv.VerticalOffset;
                double next = cur + (target - cur) * 0.22;
                if (Math.Abs(target - next) < 0.6) { next = target; CompositionTarget.Rendering -= step; running = false; }
                if (horizontal) sv.ScrollToHorizontalOffset(next); else sv.ScrollToVerticalOffset(next);
            };
            sv.PreviewMouseWheel += (s, e) =>
            {
                double max = horizontal ? sv.ScrollableWidth : sv.ScrollableHeight;
                if (max <= 0) return;
                double cur = horizontal ? sv.HorizontalOffset : sv.VerticalOffset;
                if (!running) target = cur;
                double nt = Math.Max(0, Math.Min(max, target - e.Delta * 1.1));
                if (horizontal && (nt == target)) return;   // let the page scroll when a card row is at its end
                target = nt; e.Handled = true;
                if (!running) { running = true; CompositionTarget.Rendering += step; }
            };
            sv.ScrollChanged += (s, e) => { if (!running) target = horizontal ? sv.HorizontalOffset : sv.VerticalOffset; };
            return sv;
        }

        public static string Fmt(double s) { if (!(s > 0)) s = 0; int t = (int)Math.Floor(s); return (t / 60) + ":" + (t % 60).ToString("00"); }
        public static void Fade(UIElement el, double to, int ms, Action done = null)
        {
            var a = new DoubleAnimation(to, TimeSpan.FromMilliseconds(ms)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } };
            if (done != null) a.Completed += (s, e) => done();
            el.BeginAnimation(UIElement.OpacityProperty, a);
        }
    }

    /// <summary>A thin progress / seek bar: track, fill and a knob that appears on hover.</summary>
    class SeekBar : Grid
    {
        readonly Border fill, knob; readonly ScaleTransform scale = new ScaleTransform(0, 1);
        public event Action<double> Seeked; public bool Dragging; double value;
        public SeekBar(double height, Color track, Color fg)
        {
            Height = 18; Background = Brushes.Transparent; Cursor = Cursors.Hand;
            var tr = new Border { Height = height, CornerRadius = Ui.CR(height / 2), Background = Ui.Br(track), VerticalAlignment = VerticalAlignment.Center };
            fill = new Border { Height = height, CornerRadius = Ui.CR(height / 2), Background = Ui.Br(fg), VerticalAlignment = VerticalAlignment.Center, RenderTransform = scale, RenderTransformOrigin = new Point(0, 0.5) };
            knob = new Border { Width = 13, Height = 13, CornerRadius = Ui.CR(6.5), Background = Ui.Br(Colors.White), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Center, Opacity = 0, IsHitTestVisible = false };
            Children.Add(tr); Children.Add(fill); Children.Add(knob);
            MouseEnter += (s, e) => Ui.Fade(knob, 1, 120);
            MouseLeave += (s, e) => { if (!Dragging) Ui.Fade(knob, 0, 200); };
            MouseLeftButtonDown += (s, e) => { Dragging = true; CaptureMouse(); Show(At(e)); e.Handled = true; };
            MouseMove += (s, e) => { if (Dragging) Show(At(e)); };
            MouseLeftButtonUp += (s, e) => { if (!Dragging) return; Dragging = false; ReleaseMouseCapture(); var v = At(e); Show(v); if (Seeked != null) Seeked(v); };
            SizeChanged += (s, e) => Show(value);
        }
        double At(MouseEventArgs e) { return ActualWidth > 0 ? Math.Max(0, Math.Min(1, e.GetPosition(this).X / ActualWidth)) : 0; }
        void Show(double v) { value = v; scale.ScaleX = v; knob.Margin = new Thickness(Math.Max(0, v * ActualWidth - 6.5), 0, 0, 0); }
        public void Set(double v) { if (!Dragging) Show(double.IsNaN(v) ? 0 : Math.Max(0, Math.Min(1, v))); }
    }
}
