using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;

namespace YouPlay
{
    partial class MainWindow
    {
        // ═════════ player bar ═════════
        Border bar, barArt, bPlay, bLike, bShuffle, bRepeat; TextBlock bTitle, bArtist, bCur, bDur; SeekBar bSeek; Slider vol;
        FrameworkElement BuildPlayerBar()
        {
            var g = new Grid { Height = 88, Margin = new Thickness(18, 0, 18, 0) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star), MinWidth = 220 });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.5, GridUnitType.Star), MinWidth = 340 });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star), MinWidth = 220 });
            // left: track
            var left = new Grid { VerticalAlignment = VerticalAlignment.Center };
            left.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); left.ColumnDefinitions.Add(new ColumnDefinition()); left.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            barArt = Ui.Cover(null, 56, 56, 10, "music"); left.Children.Add(barArt);
            var meta = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(14, 0, 10, 0) };
            bTitle = Ui.Text("", 14.5, Ui.TEXT, true); bArtist = Ui.Text("", 12.5, Ui.MUTED); bArtist.Margin = new Thickness(0, 4, 0, 0); bArtist.Cursor = Cursors.Hand;
            bArtist.MouseLeftButtonUp += (s, e) => { if (P.Cur != null) { OpenArtistFor(P.Cur); e.Handled = true; } };
            bArtist.MouseEnter += (s, e) => bArtist.TextDecorations = TextDecorations.Underline; bArtist.MouseLeave += (s, e) => bArtist.TextDecorations = null;
            meta.Children.Add(bTitle); meta.Children.Add(bArtist); Grid.SetColumn(meta, 1); left.Children.Add(meta);
            bLike = Ui.IconButton("heartLine", 36, 19, Ui.TEXT, Colors.Transparent, Like, "Нравится"); Grid.SetColumn(bLike, 2); left.Children.Add(bLike);
            var leftHit = new Border { Child = left, Background = Brushes.Transparent, Cursor = Cursors.Hand };
            leftHit.MouseLeftButtonUp += (s, e) => { if (!(e.OriginalSource is FrameworkElement) || !IsInside(e.OriginalSource as DependencyObject, bLike)) OpenNP(); };
            g.Children.Add(leftHit);
            // center: controls + seek
            var center = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(10, 0, 10, 0) };
            var ctl = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Center };
            bShuffle = Ui.IconButton("shuffle", 34, 18, Ui.MUTED, Colors.Transparent, ToggleShuffle, "Перемешать");
            bPlay = Ui.IconButton("play", 40, 20, Ui.OnFill, Ui.Fill, () => P.Toggle(), "Пауза / играть");
            bRepeat = Ui.IconButton("repeat", 34, 18, Ui.MUTED, Colors.Transparent, CycleRepeat, "Повтор");
            foreach (var b in new[] { bShuffle, Ui.IconButton("prev", 36, 20, Ui.TEXT, Colors.Transparent, () => P.Prev(), "Назад"), bPlay, Ui.IconButton("next", 36, 20, Ui.TEXT, Colors.Transparent, () => P.Next(false), "Дальше"), bRepeat }) { b.Margin = new Thickness(7, 0, 7, 0); ctl.Children.Add(b); }
            center.Children.Add(ctl);
            var sk = new Grid { Margin = new Thickness(0, 4, 0, 0) };
            sk.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(42) }); sk.ColumnDefinitions.Add(new ColumnDefinition()); sk.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(42) });
            bCur = Ui.Text("0:00", 11.5, Ui.MUTED); bCur.HorizontalAlignment = HorizontalAlignment.Right; bCur.VerticalAlignment = VerticalAlignment.Center; bCur.Margin = new Thickness(0, 0, 10, 0); sk.Children.Add(bCur);
            bSeek = new SeekBar(4, Ui.A(Colors.White, 0x30), Ui.TEXT); bSeek.Seeked += v => { if (P.Dur > 0) P.Seek(v * P.Dur); lyLast = -2; }; Grid.SetColumn(bSeek, 1); sk.Children.Add(bSeek);
            bDur = Ui.Text("0:00", 11.5, Ui.MUTED); bDur.VerticalAlignment = VerticalAlignment.Center; bDur.Margin = new Thickness(10, 0, 0, 0); Grid.SetColumn(bDur, 2); sk.Children.Add(bDur);
            center.Children.Add(sk);
            Grid.SetColumn(center, 1); g.Children.Add(center);
            // right: lyrics, queue, eq, volume
            var right = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
            right.Children.Add(Ui.IconButton("lyrics", 36, 19, Ui.TEXT, Colors.Transparent, () => { OpenNP(); SetPane("lyrics"); }, "Текст"));
            right.Children.Add(Ui.IconButton("queue", 36, 19, Ui.TEXT, Colors.Transparent, () => { OpenNP(); SetPane("queue"); }, "Очередь"));
            right.Children.Add(Ui.IconButton("eq", 36, 19, Ui.TEXT, Colors.Transparent, OpenEqualizer, "Эквалайзер"));
            var vi = Ui.Icon("volume", 19, Ui.MUTED); vi.Margin = new Thickness(10, 0, 6, 0); vi.VerticalAlignment = VerticalAlignment.Center; right.Children.Add(vi);
            vol = new Slider { Width = 104, Minimum = 0, Maximum = 1, Value = Store.Num("volume", 1), VerticalAlignment = VerticalAlignment.Center, IsMoveToPointEnabled = true, Foreground = Ui.Br(Ui.TEXT) };
            vol.ValueChanged += (s, e) => { E.Volume(vol.Value); Store.Set("volume", vol.Value); };
            right.Children.Add(vol);
            right.Children.Add(Ui.IconButton("expand", 36, 18, Ui.TEXT, Colors.Transparent, OpenNP, "На весь экран"));
            Grid.SetColumn(right, 2); g.Children.Add(right);
            bar = new Border { Child = g, Background = Ui.Br(Ui.SURF), BorderBrush = Ui.Br(Ui.A(Colors.White, 0x10)), BorderThickness = new Thickness(0, 1, 0, 0), Visibility = Visibility.Collapsed };
            return bar;
        }
        static bool IsInside(DependencyObject d, DependencyObject parent) { while (d != null) { if (d == parent) return true; d = VisualTreeHelper.GetParent(d); } return false; }
        void RebuildPlayerBarColors() { PaintNP(); }
        void ToggleShuffle() { P.Shuffle = !P.Shuffle; Toast(P.Shuffle ? "Перемешивание включено" : "Перемешивание выключено"); PaintNP(); }
        void CycleRepeat() { P.Repeat = (P.Repeat + 1) % 3; Toast(P.Repeat == 0 ? "Повтор выключен" : P.Repeat == 1 ? "Повтор очереди" : "Повтор трека"); PaintNP(); }

        void PlayList(List<Track> l, int i, string name)
        {
            if (l == null || l.Count == 0) return;
            P.PlayList(l, i, name);
            if (Store.Bool("autoNP", true)) OpenNP();
        }

        // ═════════ Now Playing ═════════
        Grid npLayer, npMid; bool npOpen; Border npArt, npPlay, npLike, npDislike, npShuffle, npRepeat, tabLy, tabQ; TextBlock npTitle, npArtist, npSrc, npCur, npDur, lySrc; Border npBadgeHost;
        System.Windows.Controls.Image npBg; SeekBar npSeek; ScrollViewer qScroll; StackPanel qList; Grid lyBox; StackPanel lyPanel; TranslateTransform lyShift = new TranslateTransform(); string npPane = "lyrics";
        Grid BuildNowPlaying()
        {
            var L = new Grid { Visibility = Visibility.Collapsed, Background = Ui.Br(Color.FromRgb(Ui.BG.R, Ui.BG.G, Ui.BG.B)), ClipToBounds = true };
            npBg = new System.Windows.Controls.Image { Stretch = Stretch.UniformToFill, Opacity = 0.75 };
            RenderOptions.SetBitmapScalingMode(npBg, BitmapScalingMode.HighQuality);
            L.Children.Add(npBg);
            clipHost = new Grid { Opacity = 0, IsHitTestVisible = false }; L.Children.Add(clipHost);
            L.Children.Add(new Border { IsHitTestVisible = false, Background = new LinearGradientBrush(new GradientStopCollection { new GradientStop(Ui.A(Ui.BG, 0x30), 0), new GradientStop(Ui.A(Ui.BG, 0x78), 0.55), new GradientStop(Ui.A(Ui.BG, 0xC8), 1) }, 90) });
            L.Children.Add(new Border { IsHitTestVisible = false, Background = new LinearGradientBrush(new GradientStopCollection { new GradientStop(Ui.A(Ui.BG, 0xB0), 0), new GradientStop(Ui.A(Ui.BG, 0x40), 0.45), new GradientStop(Ui.A(Ui.BG, 0x10), 1) }, 0) });
            var g = new Grid { Margin = new Thickness(40, 18, 40, 26) };
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); g.RowDefinitions.Add(new RowDefinition());
            // top
            var top = new Grid();
            var down = Ui.IconButton("down", 42, 24, Ui.TEXT, Colors.Transparent, CloseNP, "Свернуть (Esc)"); down.HorizontalAlignment = HorizontalAlignment.Left; top.Children.Add(down);
            npSrc = Ui.Text("", 12, Ui.MUTED, true); npSrc.HorizontalAlignment = HorizontalAlignment.Center; npSrc.VerticalAlignment = VerticalAlignment.Center; top.Children.Add(npSrc);
            var more = Ui.IconButton("dots", 42, 22, Ui.TEXT, Colors.Transparent, () => { if (P.Cur != null) TrackMenu(P.Cur, null); }, "Ещё"); more.HorizontalAlignment = HorizontalAlignment.Right; top.Children.Add(more);
            g.Children.Add(top);
            // body: left player, right lyrics / queue
            var body = new Grid { Margin = new Thickness(0, 10, 0, 0) };
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(0.9, GridUnitType.Star), MaxWidth = 520 });
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(56) });
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.25, GridUnitType.Star) });
            Grid.SetRow(body, 1); g.Children.Add(body);
            var left = new Grid();
            left.RowDefinitions.Add(new RowDefinition()); left.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            npArt = new Border { CornerRadius = Ui.CR(18), Background = Ui.Br(Ui.S2), HorizontalAlignment = HorizontalAlignment.Stretch, Effect = new DropShadowEffect { BlurRadius = 50, ShadowDepth = 14, Opacity = 0.5 } };
            var artBox = new Grid();
            // the cover flips over: the back side tells about the track
            flipBox = new Grid { RenderTransformOrigin = new Point(0.5, 0.5), RenderTransform = new ScaleTransform(1, 1), Cursor = Cursors.Hand, ToolTip = "Нажмите — обложка перевернётся: исполнители, альбом, год" };
            npBack = new Border { CornerRadius = Ui.CR(18), Background = Ui.Br(Ui.A(Ui.SURF, 0xF0)), BorderBrush = Ui.Br(Ui.A(Colors.White, 0x18)), BorderThickness = new Thickness(1), Visibility = Visibility.Collapsed, Padding = new Thickness(22, 18, 22, 18) };
            flipBox.Children.Add(npArt); flipBox.Children.Add(npBack);
            artBox.Children.Add(flipBox);
            flipBox.MouseLeftButtonUp += (s, e) => { if (P.Cur != null) FlipCover(); };
            artBox.SizeChanged += (s, e) => { double side = Math.Max(120, Math.Min(e.NewSize.Width, e.NewSize.Height)); npArt.Width = side; npArt.Height = side; npBack.Width = side; npBack.Height = side; };
            left.Children.Add(artBox);
            var ctrls = new StackPanel { Margin = new Thickness(0, 22, 0, 0) };
            var mg = new Grid(); mg.ColumnDefinitions.Add(new ColumnDefinition()); mg.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var mt = new StackPanel();
            npTitle = Ui.Text("", 26, Ui.TEXT, true, true); npTitle.FontWeight = FontWeights.Bold;
            npArtist = Ui.Text("", 15, Ui.MUTED); npArtist.Margin = new Thickness(0, 4, 0, 8); npArtist.Cursor = Cursors.Hand; npArtist.ToolTip = "Открыть страницу исполнителя";
            npArtist.MouseLeftButtonUp += (s, e) => { if (P.Cur != null) { CloseNP(); OpenArtistFor(P.Cur); } };
            npArtist.MouseEnter += (s, e) => npArtist.TextDecorations = TextDecorations.Underline; npArtist.MouseLeave += (s, e) => npArtist.TextDecorations = null;
            npBadgeHost = new Border { HorizontalAlignment = HorizontalAlignment.Left };
            mt.Children.Add(npTitle); mt.Children.Add(npArtist); mt.Children.Add(npBadgeHost);
            mg.Children.Add(mt);
            var acts = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            acts.Children.Add(Ui.IconButton("plus", 44, 21, Ui.TEXT, Ui.A(Colors.White, 0x1C), () => { if (P.Cur != null) AddToPlaylist(P.Cur); }, "В плейлист"));
            npLike = Ui.IconButton("heartLine", 44, 21, Ui.TEXT, Ui.A(Colors.White, 0x1C), Like, "Нравится"); npLike.Margin = new Thickness(8, 0, 0, 0); acts.Children.Add(npLike);
            npDislike = Ui.IconButton("broken", 44, 21, Ui.TEXT, Ui.A(Colors.White, 0x1C), () => Dislike(P.Cur), "Не предлагать"); npDislike.Margin = new Thickness(8, 0, 0, 0); acts.Children.Add(npDislike);
            Grid.SetColumn(acts, 1); mg.Children.Add(acts);
            ctrls.Children.Add(mg);
            npSeek = new SeekBar(5, Ui.A(Colors.White, 0x38), Ui.TEXT) { Margin = new Thickness(0, 16, 0, 0) }; npSeek.Seeked += v => { if (P.Dur > 0) P.Seek(v * P.Dur); lyLast = -2; };
            ctrls.Children.Add(npSeek);
            var times = new Grid(); npCur = Ui.Text("0:00", 12, Ui.MUTED); npDur = Ui.Text("0:00", 12, Ui.MUTED); npDur.HorizontalAlignment = HorizontalAlignment.Right; times.Children.Add(npCur); times.Children.Add(npDur);
            ctrls.Children.Add(times);
            var cg = new Grid { Margin = new Thickness(0, 14, 0, 0) };
            for (int i = 0; i < 5; i++) cg.ColumnDefinitions.Add(new ColumnDefinition());
            npShuffle = Ui.IconButton("shuffle", 46, 23, Ui.TEXT, Colors.Transparent, ToggleShuffle, "Перемешать");
            npPlay = Ui.IconButton("play", 72, 32, Ui.OnFill, Ui.Fill, () => P.Toggle(), "Пауза / играть (пробел)");
            npRepeat = Ui.IconButton("repeat", 46, 23, Ui.TEXT, Colors.Transparent, CycleRepeat, "Повтор");
            var cs = new[] { npShuffle, Ui.IconButton("prev", 54, 28, Ui.TEXT, Colors.Transparent, () => P.Prev(), "Назад"), npPlay, Ui.IconButton("next", 54, 28, Ui.TEXT, Colors.Transparent, () => P.Next(false), "Дальше"), npRepeat };
            for (int i = 0; i < cs.Length; i++) { Grid.SetColumn(cs[i], i); cg.Children.Add(cs[i]); }
            ctrls.Children.Add(cg);
            var panes = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 16, 0, 0) };
            tabLy = Ui.Pill("Текст", false, () => SetPane("lyrics"), "lyrics"); tabQ = Ui.Pill("Очередь", false, () => SetPane("queue"), "queue"); tabQ.Margin = new Thickness(10, 0, 0, 0);
            panes.Children.Add(tabLy); panes.Children.Add(tabQ);
            ctrls.Children.Add(panes);
            Grid.SetRow(ctrls, 1); left.Children.Add(ctrls);
            body.Children.Add(left);
            // right pane
            npMid = new Grid(); Grid.SetColumn(npMid, 2); body.Children.Add(npMid);
            lyBox = new Grid { ClipToBounds = true, Margin = new Thickness(0, 0, 0, 56) };
            lyBox.SizeChanged += (s, e) => { lyLast = -2; lyManual = DateTime.MinValue; };
            lyPanel = new StackPanel { RenderTransform = lyShift, VerticalAlignment = VerticalAlignment.Top };
            var lyCanvas = new Canvas(); lyCanvas.Children.Add(lyPanel); lyBox.Children.Add(lyCanvas);
            lyBox.SizeChanged += (s, e) => lyPanel.Width = Math.Max(100, e.NewSize.Width);   // a canvas never clips the long lyrics column to the box height
            lyBox.PreviewMouseWheel += (s, e) => { lyManual = DateTime.Now; var y = lyShift.Y + e.Delta * 0.6; lyShift.BeginAnimation(TranslateTransform.YProperty, null); lyShift.Y = ClampShift(y); e.Handled = true; };
            npMid.Children.Add(lyBox);
            var lyFoot = new Grid { VerticalAlignment = VerticalAlignment.Bottom };
            lySrc = Ui.Text("", 11.5, Ui.FAINT); lySrc.VerticalAlignment = VerticalAlignment.Center; lyFoot.Children.Add(lySrc);
            var off = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            lyOffText = Ui.Text("синхр.", 12, Ui.TEXT, true);
            off.Children.Add(SmallChip("−0,5 с", () => Nudge(-0.5))); off.Children.Add(SmallChipEl(lyOffText, () => Nudge(0))); off.Children.Add(SmallChip("+0,5 с", () => Nudge(0.5)));
            lyFoot.Children.Add(off);
            npMid.Children.Add(lyFoot);
            qList = new StackPanel(); qScroll = Ui.Scroll(qList); qScroll.Visibility = Visibility.Collapsed;
            npMid.Children.Add(qScroll);
            L.Children.Add(g);
            L.RenderTransform = new TranslateTransform();
            return L;
        }
        TextBlock lyOffText; DateTime lyManual = DateTime.MinValue;
        static string Norm(string s) { return Regex.Replace((s ?? "").ToLowerInvariant(), @"[^\p{L}\p{N}]", ""); }
        Grid flipBox; Border npBack; bool flipped, flipping; string backFor;
        void FlipCover()
        {
            if (flipping) return;
            flipping = true;
            var st = (ScaleTransform)flipBox.RenderTransform;
            var half = new System.Windows.Media.Animation.DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(170)) { EasingFunction = new System.Windows.Media.Animation.QuadraticEase { EasingMode = System.Windows.Media.Animation.EasingMode.EaseIn } };
            half.Completed += (s, e) =>
            {
                flipped = !flipped;
                npArt.Visibility = flipped ? Visibility.Collapsed : Visibility.Visible;
                npBack.Visibility = flipped ? Visibility.Visible : Visibility.Collapsed;
                if (flipped && P.Cur != null && backFor != P.Cur.Key) { backFor = P.Cur.Key; var sp = new StackPanel(); var sv = Ui.Scroll(sp); npBack.Child = sv; FillTrackInfo(sp, P.Cur, true); }
                var back = new System.Windows.Media.Animation.DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(220)) { EasingFunction = new System.Windows.Media.Animation.BackEase { Amplitude = 0.25, EasingMode = System.Windows.Media.Animation.EasingMode.EaseOut } };
                back.Completed += (a, b) => flipping = false;
                st.BeginAnimation(ScaleTransform.ScaleXProperty, back);
            };
            st.BeginAnimation(ScaleTransform.ScaleXProperty, half);
        }
        void UnflipCover() { if (flipped && !flipping) FlipCover(); backFor = null; }
        readonly System.Diagnostics.Stopwatch lyClock = System.Diagnostics.Stopwatch.StartNew(); double lyPrev = -1;
        double ClampShift(double y) { double h = lyBox.ActualHeight, ph = lyPanel.ActualHeight; if (h <= 0) return y; return Math.Max(Math.Min(h * 0.45, -ph + h * 0.45), Math.Min(h * 0.45, y)); }

        // ── backdrop: the cover blurred once into a small bitmap (no live blur, so lyrics stay smooth) ──
        void SetBackdrop(string url)
        {
            if (string.IsNullOrEmpty(url) || !url.StartsWith("http")) { npBg.Source = null; return; }
            try
            {
                var bi = new System.Windows.Media.Imaging.BitmapImage();
                bi.BeginInit(); bi.UriSource = new Uri(url); bi.DecodePixelWidth = 120; bi.CacheOption = System.Windows.Media.Imaging.BitmapCacheOption.OnLoad; bi.EndInit();
                Action make = () =>
                {
                    var holder = new Grid { Width = 120, Height = 120, ClipToBounds = true };
                    holder.Children.Add(new System.Windows.Controls.Image { Source = bi, Stretch = Stretch.UniformToFill, Margin = new Thickness(-22), Effect = new BlurEffect { Radius = 16 } });
                    holder.Measure(new Size(120, 120)); holder.Arrange(new Rect(0, 0, 120, 120)); holder.UpdateLayout();
                    var rtb = new System.Windows.Media.Imaging.RenderTargetBitmap(120, 120, 96, 96, PixelFormats.Pbgra32); rtb.Render(holder); rtb.Freeze();
                    npBg.Source = rtb;
                };
                if (bi.IsDownloading) bi.DownloadCompleted += (s, e) => make(); else make();
            }
            catch { npBg.Source = null; }
        }

        // ── the music video behind Now Playing (only on this screen, muted, follows the song) ──
        Grid clipHost; Microsoft.Web.WebView2.Wpf.WebView2CompositionControl clipView; string clipFor, clipId; bool clipReady, clipPlaying; DateTime clipSync;
        async void CheckClip()
        {
            var t = P.Cur;
            if (!npOpen || t == null || t.Src != "yt" || !Store.Bool("clipBg", false)) { StopClip(); return; }
            if (clipFor == t.Key) return;
            clipFor = t.Key;
            var r = await E.Eng("clip", "videoId", t.VideoId);
            if (P.Cur == null || P.Cur.Key != t.Key || !npOpen) return;
            var id = J.S(r, "clip");
            if (id.Length == 0)
            {
                var baseTitle = Norm(Regex.Replace(Clean(t.Title), @"\s*[(\[].*$", ""));
                var artist = Norm(Regex.Split(t.Artist, @",| и | & | feat", RegexOptions.IgnoreCase)[0]);
                var s = await E.Eng("search", "q", t.Title + " " + Regex.Split(t.Artist, @",| и | & ", RegexOptions.IgnoreCase)[0] + " official video", "low", true);
                if (P.Cur == null || P.Cur.Key != t.Key || !npOpen) return;
                var bad = new Regex("lyric|текст|karaoke|караоке|visuali|audio|slowed|sped|reverb|8d|nightcore|cover|live|концерт", RegexOptions.IgnoreCase);
                var cands = Track.List(J.A(s, "tracks"), "yt").Where(x => x.Kind == "video" && baseTitle.Length > 1 && Norm(x.Title).Contains(baseTitle) && (artist.Length == 0 || Norm(x.Artist + x.Title).Contains(artist)) && !bad.IsMatch(x.Title)).ToList();
                var hit = cands.FirstOrDefault(x => Regex.IsMatch(x.Title, "official|video|клип", RegexOptions.IgnoreCase)) ?? cands.FirstOrDefault();
                if (hit != null) id = hit.VideoId;
            }
            if (id.Length == 0) { StopClip(); return; }
            await EnsureClipView();
            if (clipView == null || clipView.CoreWebView2 == null) return;
            clipId = id; clipPlaying = false;
            try { await clipView.CoreWebView2.ExecuteScriptAsync("window.loadClip && loadClip(" + J.Str(id) + "," + ((int)P.Time).ToString() + ")"); } catch { }
        }
        async Task EnsureClipView()
        {
            if (clipView != null) { if (!clipReady) await Task.Delay(1500); return; }
            try
            {
                clipView = new Microsoft.Web.WebView2.Wpf.WebView2CompositionControl { IsHitTestVisible = false };
                clipHost.Children.Add(clipView); clipHost.Children.Add(new Border { Background = Ui.Br(Ui.A(Colors.Black, 0x8C)), IsHitTestVisible = false });
                await clipView.EnsureCoreWebView2Async(E.Env);
                var c = clipView.CoreWebView2;
                c.IsMuted = true;
                c.Settings.AreDefaultContextMenusEnabled = false;
                E.Block(c);
                c.AddWebResourceRequestedFilter("https://youplay.local/*", Microsoft.Web.WebView2.Core.CoreWebView2WebResourceContext.All);
                c.WebResourceRequested += (s, e) => { if (e.Request.Uri.StartsWith("https://youplay.local/")) e.Response = E.Env.CreateWebResourceResponse(new System.IO.MemoryStream(System.Text.Encoding.UTF8.GetBytes(ClipHtml)), 200, "OK", "Content-Type: text/html; charset=utf-8"); };
                c.WebMessageReceived += (s, e) =>
                {
                    var m = J.Parse(e.TryGetWebMessageAsString());
                    if (J.S(m, "ev") == "ready") clipReady = true;
                    else if (J.S(m, "ev") == "playing") { if (!clipPlaying) { clipPlaying = true; Ui.Fade(clipHost, 1, 900); } }
                    else if (J.S(m, "ev") == "error") StopClip();
                };
                var done = new TaskCompletionSource<bool>();
                c.NavigationCompleted += (s, e) => done.TrySetResult(true);
                c.Navigate("https://youplay.local/clip.html");
                await done.Task; await Task.Delay(1200);
            }
            catch { clipView = null; }
        }
        void StopClip()
        {
            clipPlaying = false; clipId = null;
            Ui.Fade(clipHost, 0, 300);
            try { if (clipView != null && clipView.CoreWebView2 != null) clipView.CoreWebView2.ExecuteScriptAsync("window.stopClip && stopClip()"); } catch { }
        }
        void SyncClip()
        {
            if (clipView == null || clipId == null || clipView.CoreWebView2 == null || (DateTime.Now - clipSync).TotalSeconds < 2) return;
            clipSync = DateTime.Now;
            try { clipView.CoreWebView2.ExecuteScriptAsync("window.syncClip && syncClip(" + P.Time.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) + "," + (P.Playing ? "true" : "false") + ")"); } catch { }
        }
        const string ClipHtml = @"<!doctype html><html><head><meta charset='utf-8'><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#p,iframe{position:fixed;left:-17.5vw;top:-17.5vh;width:135vw!important;height:135vh!important;border:0;pointer-events:none}</style></head><body><div id='p'></div>
<script>
function send(o){try{chrome.webview.postMessage(JSON.stringify(o));}catch(e){}}
var pl=null,want=null;
function onYouTubeIframeAPIReady(){send({ev:'ready'});if(want)loadClip(want[0],want[1]);}
window.loadClip=function(id,t){if(!window.YT||!YT.Player){want=[id,t];return;}if(pl&&pl.loadVideoById){pl.loadVideoById({videoId:id,startSeconds:t});pl.mute();return;}
pl=new YT.Player('p',{videoId:id,playerVars:{autoplay:1,mute:1,controls:0,disablekb:1,fs:0,iv_load_policy:3,modestbranding:1,rel:0,playsinline:1,start:Math.floor(t)},
events:{onReady:function(e){e.target.mute();e.target.playVideo();},onStateChange:function(e){if(e.data===1)send({ev:'playing'});},onError:function(){send({ev:'error'});}}});};
window.syncClip=function(t,playing){if(!pl||!pl.getCurrentTime)return;if(Math.abs(pl.getCurrentTime()-t)>1.5)pl.seekTo(t,true);var s=pl.getPlayerState();if(playing&&s!==1)pl.playVideo();if(!playing&&s===1)pl.pauseVideo();};
window.stopClip=function(){if(pl&&pl.stopVideo)pl.stopVideo();};
</script><script src='https://www.youtube.com/iframe_api'></script></body></html>";
        Border SmallChip(string s, Action a) { return SmallChipEl(Ui.Text(s, 12, Ui.TEXT, true), a); }
        Border SmallChipEl(TextBlock t, Action a) { t.VerticalAlignment = VerticalAlignment.Center; return Ui.Click(new Border { Height = 30, Padding = new Thickness(12, 0, 12, 0), CornerRadius = Ui.CR(15), Background = Ui.Br(Ui.A(Colors.White, 0x18)), Child = t, Margin = new Thickness(6, 0, 0, 0) }, a, Ui.A(Colors.White, 0x2A)); }
        void SetPane(string p)
        {
            npPane = p;
            bool ly = p == "lyrics";
            lyBox.Visibility = ly ? Visibility.Visible : Visibility.Collapsed;
            ((FrameworkElement)npMid.Children[1]).Visibility = ly ? Visibility.Visible : Visibility.Collapsed;
            qScroll.Visibility = ly ? Visibility.Collapsed : Visibility.Visible;
            PaintTab(tabLy, ly); PaintTab(tabQ, !ly);
            if (!ly) PaintQueue();
            lyLast = -2;
        }
        void PaintTab(Border b, bool on)
        {
            b.Background = Ui.Br(on ? Ui.Fill : Ui.A(Colors.White, 0x1C));
            var sp = b.Child as StackPanel; if (sp == null) return;
            foreach (var c in sp.Children) { var t = c as TextBlock; if (t != null) t.Foreground = Ui.Br(on ? Ui.OnFill : Ui.TEXT); var f = c as FrameworkElement; if (f is Viewbox) Ui.Recolor(f, on ? Ui.OnFill : Ui.TEXT); }
        }
        void OpenNP()
        {
            if (P.Cur == null || npOpen) return;
            npOpen = true; npLayer.Visibility = Visibility.Visible;
            var tt = (TranslateTransform)npLayer.RenderTransform;
            tt.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(ActualHeight, 0, TimeSpan.FromMilliseconds(340)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
            PaintNP(); SetPane(npPane);
            clipFor = null; CheckClip();
        }
        void CloseNP()
        {
            if (!npOpen) return;
            npOpen = false; StopClip(); clipFor = null;
            var tt = (TranslateTransform)npLayer.RenderTransform;
            var a = new DoubleAnimation(0, ActualHeight, TimeSpan.FromMilliseconds(260)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseIn } };
            a.Completed += (s, e) => { if (!npOpen) npLayer.Visibility = Visibility.Collapsed; };
            tt.BeginAnimation(TranslateTransform.YProperty, a);
        }
        void PaintQueue()
        {
            qList.Children.Clear();
            if (P.List.Count == 0) { qList.Children.Add(Note("Очередь пуста")); return; }
            var hdr = Ui.Text("Очередь · " + (P.Name.Length > 0 ? P.Name : "Сейчас играет"), 18, Ui.TEXT, true, true); hdr.Margin = new Thickness(6, 0, 0, 12); qList.Children.Add(hdr);
            for (int i = 0; i < P.List.Count; i++)
            {
                int k = i; var row = (Border)Row(P.List[i], P.List, i, P.Name, null);
                row.MouseLeftButtonUp += (s, e) => { P.PlayAt(k); e.Handled = true; };
                qList.Children.Add(row);
            }
            if (P.I > 2) Dispatcher.BeginInvoke((Action)(() => qScroll.ScrollToVerticalOffset(Math.Max(0, (P.I - 2) * 58))), System.Windows.Threading.DispatcherPriority.Loaded);
        }
        void PaintNP()
        {
            var t = P.Cur;
            Ui.SetIcon(bPlay, P.Playing ? "pause" : "play", Ui.OnFill);
            bool l = LikedNow();
            Ui.SetIcon(bLike, l ? "heart" : "heartLine", l ? Ui.Accent : Ui.TEXT);
            Ui.SetIcon(bShuffle, "shuffle", P.Shuffle ? Ui.Accent : Ui.MUTED);
            Ui.SetIcon(bRepeat, P.Repeat == 2 ? "repeat1" : "repeat", P.Repeat > 0 ? Ui.Accent : Ui.MUTED);
            if (t == null) return;
            npTitle.Text = t.Title; npArtist.Text = t.Artist; npBadgeHost.Child = Ui.Badge(t.Src, t.Kind);
            npSrc.Text = (P.Name.Length > 0 ? P.Name : "Сейчас играет").ToUpperInvariant();
            Ui.SetIcon(npPlay, P.Playing ? "pause" : "play", Ui.OnFill);
            Ui.SetIcon(npLike, l ? "heart" : "heartLine", l ? Ui.Accent : Ui.TEXT);
            Ui.SetIcon(npDislike, "broken", IsDisliked(t) || t.Disliked ? Ui.Accent : Ui.TEXT);
            Ui.SetIcon(npShuffle, "shuffle", P.Shuffle ? Ui.Accent : Ui.TEXT);
            Ui.SetIcon(npRepeat, P.Repeat == 2 ? "repeat1" : "repeat", P.Repeat > 0 ? Ui.Accent : Ui.TEXT);
        }

        // ═════════ player events ═════════
        string lastArt = "", lastKey = "";
        void OnTrack()
        {
            var t = P.Cur; if (t == null) return;
            bar.Visibility = Visibility.Visible;
            bTitle.Text = t.Title; bArtist.Text = t.Artist;
            Title = (t.Title.Length > 0 ? t.Title + " — " : "") + "YouPlay";
            if (t.Art != lastArt)
            {
                lastArt = t.Art;
                Ui.Load(barArt, t.Art, 56, "music"); Ui.Load(npArt, t.Art, 520, "music");
                SetBackdrop(t.Art);
            }
            if (t.Key != lastKey)
            {
                lastKey = t.Key;
                var recent = Store.List("recent").Where(x => Track.From(x, "yt").Key != t.Key).Take(23).ToList(); recent.Insert(0, t.Json()); Store.SetList("recent", recent);
                LoadLyrics(t);
                UnflipCover(); StopClip(); clipFor = null; if (npOpen) Dispatcher.BeginInvoke((Action)(async () => { await Task.Delay(2500); CheckClip(); }));
                if (npOpen && npPane == "queue") PaintQueue();
            }
            PaintNP();
        }
        void OnPlayState() { PaintNP(); }
        void Tick()
        {
            P.Tick();
            if (P.Cur == null) return;
            double p = P.Dur > 0 ? Math.Min(1, P.Time / P.Dur) : 0;
            bSeek.Set(p); bCur.Text = Ui.Fmt(P.Time); bDur.Text = Ui.Fmt(P.Dur);
            if (npOpen) { npSeek.Set(p); npCur.Text = Ui.Fmt(P.Time); npDur.Text = Ui.Fmt(P.Dur); SyncClip(); }
        }

        // ═════════ lyrics: LRCLIB (synced, word by word), YouTube Music as a fallback ═════════
        class Line { public double T; public string Text; public double[] Ws, We; public TextBlock View; public List<Run> Runs; }
        readonly List<Line> ly = new List<Line>();
        int lyReq, lyLast = -2; double lyDur, smooth; bool lyTempo; DateTime lyFrame = DateTime.MinValue;
        static readonly Regex TEMPO = new Regex("(slowed|sped|speed up|nightcore|daycore)", RegexOptions.IgnoreCase);
        static string Clean(string t) { t = Regex.Replace(t, @"\s*[(\[][^)\]]*(slowed|sped|reverb|nightcore|official|video|audio|lyric|mv|remaster|hd|hq|клип)[^)\]]*[)\]]", "", RegexOptions.IgnoreCase); return Regex.Replace(t, @"\s*-\s*(official|lyric).*$", "", RegexOptions.IgnoreCase).Trim(); }
        void LyMsg(string s) { lyPanel.Children.Clear(); ly.Clear(); lyShift.BeginAnimation(TranslateTransform.YProperty, null); lyShift.Y = 120; var t = Ui.Wrap(s, 20, Ui.MUTED, true); lyPanel.Children.Add(t); }
        async void LoadLyrics(Track it)
        {
            int my = ++lyReq; lyLast = -2; lyDur = 0; lySrc.Text = ""; PaintOffset();
            LyMsg("Ищу текст…");
            if (it.Title.Length == 0) { LyMsg("Текст не найден"); return; }
            if (!Online) { LyMsg("Текст недоступен без интернета"); return; }
            lyTempo = TEMPO.IsMatch(it.Title);
            string a = Regex.Split(Track.CleanArtist(it.Artist), @"•|·|,| и | & | feat\.| ft\.| x ", RegexOptions.IgnoreCase)[0];
            a = Regex.Replace(Regex.Replace(a, @"\s*-\s*topic$", "", RegexOptions.IgnoreCase), "vevo$", "", RegexOptions.IgnoreCase).Trim();
            string t = Clean(it.Title);
            if (a.Length > 0 && t.StartsWith(a, StringComparison.CurrentCultureIgnoreCase)) { var r = Regex.Replace(t.Substring(a.Length), @"^\s*[—–-]\s*", ""); if (r.Length > 0) t = r; }
            bool net = false; Dictionary<string, object> res = null;
            Func<string, Task<Dictionary<string, object>>> get = async url => { for (int k = 0; k < 2; k++) { var r = await Http.Get(url); int st = (int)J.D(r, "status"); if (st == 200) return r; if (st == 404) return null; net = true; } return null; };
            Func<Dictionary<string, object>, Dictionary<string, object>> best = r =>
            {
                if (r == null) return null;
                object parsed; try { parsed = J.Ser.DeserializeObject(J.S(r, "body")); } catch { return null; }
                var arr = parsed as object[]; if (arr == null) return null;
                Dictionary<string, object> b = null; double score = -1e9;
                foreach (var o in arr) { var x = o as Dictionary<string, object>; if (x == null) continue; double sc = (J.S(x, "syncedLyrics").Length > 0 ? 1000 : 0) - Math.Abs(J.D(x, "duration") - (P.Dur > 0 ? P.Dur : J.D(x, "duration"))); if (sc > score) { score = sc; b = x; } }
                return b;
            };
            if (!lyTempo)
            {
                var r = await get("https://lrclib.net/api/get?track_name=" + Http.Enc(t) + "&artist_name=" + Http.Enc(a) + (it.Duration > 0 ? "&duration=" + (int)it.Duration : ""));
                if (r != null) { var o = J.Parse(J.S(r, "body")); if (J.S(o, "syncedLyrics").Length > 0) res = o; }
            }
            if (res == null) res = best(await get("https://lrclib.net/api/search?track_name=" + Http.Enc(t) + "&artist_name=" + Http.Enc(a)));
            if (res == null || J.S(res, "syncedLyrics").Length == 0) { var b2 = best(await get("https://lrclib.net/api/search?q=" + Http.Enc(t + " " + a))); if (b2 != null && (res == null || J.S(b2, "syncedLyrics").Length > 0)) res = b2; }
            if (my != lyReq) return;
            if (res == null || J.S(res, "syncedLyrics").Length == 0)
            {
                // Textyl: synced lyrics for many tracks LRCLIB does not have
                var tx = await Http.Get("https://api.textyl.co/api/lyrics?q=" + Http.Enc(a + " " + t));
                if (my != lyReq) return;
                if ((int)J.D(tx, "status") == 200)
                {
                    object parsed = null; try { parsed = J.Ser.DeserializeObject(J.S(tx, "body")); } catch { }
                    var arr = parsed as object[];
                    if (arr != null && arr.Length > 3)
                    {
                        var sb = new System.Text.StringBuilder();
                        foreach (var o in arr) { var x = o as Dictionary<string, object>; if (x == null) continue; double sec = J.D(x, "seconds"); sb.AppendFormat("[{0:00}:{1:00.00}]{2}\n", (int)(sec / 60), sec % 60, J.S(x, "lyrics")); }
                        res = J.Make("syncedLyrics", sb.ToString().Replace(',', '.'), "duration", 0, "via", "Textyl");
                    }
                }
            }
            if (res == null || (J.S(res, "syncedLyrics").Length == 0 && J.S(res, "plainLyrics").Length == 0))
            {
                var ov = await Http.Get("https://api.lyrics.ovh/v1/" + Http.Enc(a) + "/" + Http.Enc(t));
                if (my != lyReq) return;
                var lyr = (int)J.D(ov, "status") == 200 ? J.S(J.Parse(J.S(ov, "body")), "lyrics").Trim() : "";
                if (lyr.Length > 20) res = J.Make("plainLyrics", lyr, "via", "lyrics.ovh");
            }
            bool ytm = false;
            if ((res == null || (J.S(res, "syncedLyrics").Length == 0 && J.S(res, "plainLyrics").Length == 0)) && it.Src == "yt")
            {
                for (int k = 0; k < 3 && my == lyReq; k++)
                {
                    await Task.Delay(1500 + k * 1500);
                    if (my != lyReq || P.Cur == null || P.Cur.Key != it.Key) return;
                    var y = await E.Eng("lyrics", "videoId", it.VideoId);
                    if (J.S(y, "text").Length > 0) { res = J.Make("plainLyrics", J.S(y, "text")); ytm = true; break; }
                }
            }
            if (my != lyReq) return;
            ShowLyrics(res, net, ytm);
        }
        void ShowLyrics(Dictionary<string, object> res, bool net, bool ytm)
        {
            ly.Clear(); lyPanel.Children.Clear(); lyLast = -2;
            lyDur = res == null ? 0 : J.D(res, "duration");
            string synced = res == null ? "" : J.S(res, "syncedLyrics"), plain = res == null ? "" : J.S(res, "plainLyrics");
            if (synced.Length > 0)
            {
                var tag = new Regex(@"\[(\d+):(\d+(?:\.\d+)?)\]");
                foreach (var raw in synced.Split('\n'))
                {
                    var txt = Regex.Replace(Regex.Replace(Regex.Replace(raw, @"\[[^\]]*\]", ""), "<[^>]*>", ""), @"\s+", " ").Trim();
                    foreach (Match m in tag.Matches(raw)) ly.Add(new Line { T = int.Parse(m.Groups[1].Value) * 60 + double.Parse(m.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture), Text = txt });
                }
                ly.Sort((x, y) => x.T.CompareTo(y.T));
                for (int i = 0; i < ly.Count; i++)
                {
                    var l = ly[i];
                    double end = i + 1 < ly.Count ? Math.Min(ly[i + 1].T, l.T + 9) : l.T + 6;
                    var words = l.Text.Length == 0 ? new string[0] : l.Text.Split(' ');
                    l.Ws = new double[words.Length]; l.We = new double[words.Length];
                    double span = Math.Max(0.6, (end - l.T) * 0.85), total = words.Sum(w => w.Length + 1.5);
                    double at = l.T;
                    for (int k = 0; k < words.Length; k++) { double d = span * (words[k].Length + 1.5) / Math.Max(1, total); l.Ws[k] = at; l.We[k] = at + d; at += d; }
                    var tb = new TextBlock { FontSize = 34, FontWeight = FontWeights.Bold, FontFamily = Ui.Display, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 24, 22), Foreground = Ui.Br(Ui.A(Ui.TEXT, 0x55)), Cursor = Cursors.Hand, RenderTransformOrigin = new Point(0, 0.5), RenderTransform = new ScaleTransform(1, 1) };
                    l.Runs = new List<Run>();
                    if (words.Length == 0) tb.Inlines.Add(new Run("♪"));
                    for (int k = 0; k < words.Length; k++) { var r = new Run(words[k]); l.Runs.Add(r); tb.Inlines.Add(r); if (k < words.Length - 1) tb.Inlines.Add(new Run(" ")); }
                    int idx = i;
                    tb.MouseLeftButtonUp += (s, e) => { P.Seek(Math.Max(0, (ly[idx].T - Offset()) / Ratio())); lyLast = -2; lyManual = DateTime.MinValue; };
                    l.View = tb; lyPanel.Children.Add(tb);
                }
                lyShift.BeginAnimation(TranslateTransform.YProperty, null); lyShift.Y = 160;
                lySrc.Text = "Текст: " + (J.S(res, "via").Length > 0 ? J.S(res, "via") : "LRCLIB") + " · подсветка по словам";
            }
            else if (plain.Length > 0)
            {
                var tb = Ui.Wrap(plain.Replace("\r", ""), 22, Ui.TEXT, true); tb.LineHeight = 34; lyPanel.Children.Add(tb);
                lyShift.BeginAnimation(TranslateTransform.YProperty, null); lyShift.Y = 20;
                lySrc.Text = "Синхронного текста нет — показан обычный (" + (ytm ? "YouTube Music" : J.S(res, "via").Length > 0 ? J.S(res, "via") : "LRCLIB") + "). Прокрутка колёсиком.";
            }
            else LyMsg(res != null && J.B(res, "instrumental") ? "♪ Инструментал" : net ? "Нет связи с сервером текстов" : "Текст для этой песни не найден");
        }
        double Ratio() { double d = P.Dur; if (lyDur <= 0 || d <= 0) return 1; double k = lyDur / d; return k < .55 || k > 1.8 ? 1 : (lyTempo || Math.Abs(k - 1) > .04 ? k : 1); }
        double Offset() { var o = Store.Obj("offsets"); return P.Cur != null && o != null ? J.D(o, P.Cur.Key) : 0; }
        void PaintOffset() { var o = Offset(); lyOffText.Text = o == 0 ? "синхр." : (o > 0 ? "+" : "") + o.ToString("0.0").Replace('.', ',') + " с"; }
        void Nudge(double d)
        {
            if (P.Cur == null) return;
            var o = Store.Obj("offsets") ?? new Dictionary<string, object>();
            o[P.Cur.Key] = d == 0 ? 0 : Math.Round((Offset() + d) * 10) / 10; Store.Set("offsets", o); PaintOffset(); lyLast = -2;
        }
        static readonly Color dim = Ui.A(Ui.TEXT, 0x48), past = Ui.A(Ui.TEXT, 0x6E);
        void LyricsFrame(object sender, EventArgs e)
        {
            double nowS = lyClock.Elapsed.TotalSeconds; double dt = lyPrev < 0 ? 0 : Math.Min(0.1, nowS - lyPrev); lyPrev = nowS;
            if (!npOpen || npPane != "lyrics" || ly.Count == 0 || P.Cur == null) return;
            if (P.Playing) smooth += dt;
            if (Math.Abs(smooth - P.Time) > 0.3 || !P.Playing) smooth = P.Time;
            double t = smooth * Ratio() + Offset();
            int lo = 0, hi = ly.Count - 1, i = -1; double tl = t + 0.35;
            while (lo <= hi) { int m = (lo + hi) >> 1; if (ly[m].T <= tl) { i = m; lo = m + 1; } else hi = m - 1; }
            if (i != lyLast)
            {
                for (int k = 0; k < ly.Count; k++)
                {
                    var l = ly[k]; if (k == i) continue;
                    l.View.Foreground = Ui.Br(k < i ? past : dim);
                    foreach (var r in l.Runs) { r.ClearValue(TextElement.ForegroundProperty); r.Tag = null; }
                    ((ScaleTransform)l.View.RenderTransform).BeginAnimation(ScaleTransform.ScaleXProperty, new DoubleAnimation(1, TimeSpan.FromMilliseconds(300)));
                    ((ScaleTransform)l.View.RenderTransform).BeginAnimation(ScaleTransform.ScaleYProperty, new DoubleAnimation(1, TimeSpan.FromMilliseconds(300)));
                    l.View.Effect = null;
                }
                lyLast = i;
                if (i >= 0)
                {
                    var v = ly[i].View;
                    v.Foreground = Ui.Br(dim);
                    var grow = new DoubleAnimation(1.04, TimeSpan.FromMilliseconds(380)) { EasingFunction = new BackEase { Amplitude = 0.4, EasingMode = EasingMode.EaseOut } };
                    ((ScaleTransform)v.RenderTransform).BeginAnimation(ScaleTransform.ScaleXProperty, grow); ((ScaleTransform)v.RenderTransform).BeginAnimation(ScaleTransform.ScaleYProperty, grow);
                    if ((DateTime.Now - lyManual).TotalSeconds > 4)
                    {
                        var p = v.TranslatePoint(new Point(0, 0), lyPanel);
                        double target = ClampShift(lyBox.ActualHeight * 0.38 - p.Y - v.ActualHeight / 2);
                        lyShift.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(target, TimeSpan.FromMilliseconds(650)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
                    }
                }
            }
            if (i < 0) return;
            var line = ly[i]; double tw = t + 0.12;
            for (int k = 0; k < line.Runs.Count && k < line.Ws.Length; k++)
            {
                double prog = tw >= line.We[k] ? 1 : tw <= line.Ws[k] ? 0 : (tw - line.Ws[k]) / (line.We[k] - line.Ws[k]);
                var run = line.Runs[k];
                var cur = run.Tag is double ? (double)run.Tag : -1;
                double q = Math.Round(prog * 40) / 40; if (q == cur) continue;
                run.Tag = q;
                if (q >= 1) run.Foreground = Ui.Br(Ui.TEXT);
                else if (q <= 0) run.ClearValue(TextElement.ForegroundProperty);
                else
                {
                    // the word fills from left to right
                    var b = new LinearGradientBrush { StartPoint = new Point(0, 0), EndPoint = new Point(1, 0) };
                    b.GradientStops.Add(new GradientStop(Ui.TEXT, 0)); b.GradientStops.Add(new GradientStop(Ui.TEXT, q)); b.GradientStops.Add(new GradientStop(dim, Math.Min(1, q + 0.08))); b.GradientStops.Add(new GradientStop(dim, 1));
                    b.Freeze(); run.Foreground = b;
                }
            }
        }
    }
}
