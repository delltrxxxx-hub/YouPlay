using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
using System.Windows.Threading;
using Path = System.Windows.Shapes.Path;

namespace YouPlay
{
    /// <summary>The YouPlay window: sidebar, search, pages, player bar, Now Playing, dialogs — all native WPF.</summary>
    partial class MainWindow : Window
    {
        public Engine E = new Engine();
        public Player P;
        Grid root, pageHost, overlay; Border sidebar; StackPanel nav;
        TextBox searchBox;
        readonly List<KeyValuePair<string, FrameworkElement>> stack = new List<KeyValuePair<string, FrameworkElement>>();
        readonly Dictionary<string, FrameworkElement> roots = new Dictionary<string, FrameworkElement>();
        string tab = "home";
        bool scChecked, scLogin; string scUser = "";
        readonly string boundsFile = System.IO.Path.Combine(Program.Data, "window.txt");

        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        public MainWindow()
        {
            Title = "YouPlay"; Background = Ui.Br(Ui.BG); FontFamily = Ui.Font; MinWidth = 900; MinHeight = 600;
            UseLayoutRounding = true; SnapsToDevicePixels = true;
            TextOptions.SetTextFormattingMode(this, TextFormattingMode.Ideal);
            try { Icon = System.Windows.Media.Imaging.BitmapFrame.Create(new Uri(System.IO.Path.Combine(Program.Dir, "YouPlay.exe"))); } catch { }
            LoadTheme(); FontFamily = Ui.Font;
            RestoreBounds_();
            P = new Player(E) { IsDisliked = IsDisliked };
            BuildShell();
            SourceInitialized += (s, e) => ApplyBackdrop();
            Loaded += async (s, e) => await Start();
            Closing += (s, e) => { SaveBounds(); Store.SaveNow(); try { E.Host.Close(); } catch { } };
            PreviewKeyDown += OnKey;
        }
        void Caption()
        {
            try
            {
                var h = new WindowInteropHelper(this).Handle;
                int dark = 1; DwmSetWindowAttribute(h, 20, ref dark, 4);
                int bgr = (Ui.BG.B << 16) | (Ui.BG.G << 8) | Ui.BG.R; DwmSetWindowAttribute(h, 35, ref bgr, 4); DwmSetWindowAttribute(h, 34, ref bgr, 4);
                int t = 0x00EAEEF4; DwmSetWindowAttribute(h, 36, ref t, 4);
            }
            catch { }
        }
        public bool Online = System.Net.NetworkInformation.NetworkInterface.GetIsNetworkAvailable();
        void WatchNetwork()
        {
            System.Net.NetworkInformation.NetworkChange.NetworkAvailabilityChanged += (s, e) => Dispatcher.BeginInvoke((Action)(() =>
            {
                bool was = Online; Online = e.IsAvailable;
                if (was == Online) return;
                Toast(Online ? "Интернет снова есть" : "Нет интернета — играет «Моя музыка»");
                if (Online) E.Reload();
                roots.Remove("home"); roots.Remove("lib"); if (stack.Count == 1 && (tab == "home" || tab == "lib")) ShowTab(tab);
            }));
        }
        async Task Start()
        {
            WatchNetwork();
            try { await E.Init(); }
            catch (Exception ex) { MessageBox.Show(this, "Не удалось запустить WebView2: " + ex.Message + "\n\nУстановите «Microsoft Edge WebView2 Runtime» с сайта Microsoft.", "YouPlay"); Close(); return; }
            E.Adblock = Store.Bool("adblock", true);
            E.ReadyChanged += () => { E.Eng("audioOnly", "value", true); E.Volume(Store.Num("volume", 1)); ApplyEq(); if (tab == "home" && stack.Count == 1 && Store.Obj("home") == null) LoadHome(); if (tab == "settings") ShowTab("settings"); SyncArtists(); };
            P.TrackChanged += OnTrack; P.StateChanged += OnPlayState;
            if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal; Activate(); ShowTab("home");
            var t = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) }; t.Tick += (s, e) => Tick(); t.Start();
            CompositionTarget.Rendering += LyricsFrame;
            if (Updater.Enabled) { var _ = Task.Run(() => { System.Threading.Thread.Sleep(5000); try { Updater.Check(); } catch { Updater.State = "error"; } Dispatcher.BeginInvoke((Action)OnUpdateState); }); }
        }

        // ═════════ shell ═════════
        void BuildShell()
        {
            root = new Grid();
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var top = new Grid();
            top.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(236) });
            top.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            root.Children.Add(top);

            // sidebar
            var side = new DockPanel { Margin = new Thickness(14, 18, 14, 14) };
            var logo = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(10, 0, 0, 22) };
            logo.Children.Add(LogoMark(30));
            var lt = Ui.Text("YouPlay", 21, Ui.TEXT, true, true); lt.Margin = new Thickness(10, 0, 0, 2); lt.VerticalAlignment = VerticalAlignment.Center; lt.FontWeight = FontWeights.Bold;
            logo.Children.Add(lt);
            DockPanel.SetDock(logo, Dock.Top); side.Children.Add(logo);
            var foot = new StackPanel(); DockPanel.SetDock(foot, Dock.Bottom); side.Children.Add(foot);
            var mid = new Grid(); mid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); mid.RowDefinitions.Add(new RowDefinition());
            nav = new StackPanel(); mid.Children.Add(nav);
            sideArtists = new StackPanel(); var sas = Ui.Scroll(sideArtists); Grid.SetRow(sas, 1); mid.Children.Add(sas);
            side.Children.Add(mid);
            sidebar = new Border { Child = side, BorderBrush = Ui.Br(Ui.A(Colors.White, 0x10)), BorderThickness = new Thickness(0, 0, 1, 0) };
            top.Children.Add(sidebar);
            sideFoot = foot;

            // main column: search + pages
            var main = new Grid();
            main.RowDefinitions.Add(new RowDefinition { Height = new GridLength(70) });
            main.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            Grid.SetColumn(main, 1); top.Children.Add(main);
            var sb = new Grid();
            var sbox = new Border { Height = 44, Width = 520, HorizontalAlignment = HorizontalAlignment.Left, CornerRadius = Ui.CR(22), Background = Ui.Br(Ui.S2), Margin = new Thickness(28, 14, 28, 0), BorderBrush = Ui.Br(Ui.A(Colors.White, 0x10)), BorderThickness = new Thickness(1) };
            var sg = new Grid(); sg.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); sg.ColumnDefinitions.Add(new ColumnDefinition());
            var si = Ui.Icon("search", 19, Ui.MUTED); si.Margin = new Thickness(16, 0, 8, 0); sg.Children.Add(si);
            searchBox = new TextBox { Background = Brushes.Transparent, BorderThickness = new Thickness(0), Foreground = Ui.Br(Ui.TEXT), CaretBrush = Ui.Br(Ui.TEXT), FontSize = 14.5, VerticalContentAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 16, 0), FontFamily = Ui.Font };
            var hint = Ui.Text("Треки, исполнители, SoundCloud…", 14.5, Ui.FAINT); hint.IsHitTestVisible = false; hint.VerticalAlignment = VerticalAlignment.Center; hint.Margin = new Thickness(2, 0, 0, 0);
            searchBox.TextChanged += (s, e) => hint.Visibility = searchBox.Text.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
            searchBox.KeyDown += (s, e) => { if (e.Key == Key.Enter && searchBox.Text.Trim().Length > 0) { DoSearch(searchBox.Text.Trim()); Keyboard.ClearFocus(); FocusManager.SetFocusedElement(this, this); } if (e.Key == Key.Escape) { Keyboard.ClearFocus(); } };
            var sh = new Grid(); sh.Children.Add(hint); sh.Children.Add(searchBox); Grid.SetColumn(sh, 1); sg.Children.Add(sh);
            sbox.Child = sg;
            sb.Children.Add(sbox); main.Children.Add(sb);
            pageHost = new Grid { ClipToBounds = true }; Grid.SetRow(pageHost, 1); main.Children.Add(pageHost);

            // player bar
            var bar = BuildPlayerBar(); Grid.SetRow(bar, 1); root.Children.Add(bar);
            // overlays
            overlay = new Grid(); Grid.SetRowSpan(overlay, 2);
            npLayer = BuildNowPlaying(); overlay.Children.Add(npLayer);
            dialogLayer = new Grid { Visibility = Visibility.Collapsed, Background = Ui.Br(Ui.A(Colors.Black, 0xA0)) };
            dialogLayer.MouseLeftButtonDown += (s, e) => { if (e.OriginalSource == dialogLayer) CloseDialog(); };
            overlay.Children.Add(dialogLayer);
            toastLayer = new Grid { IsHitTestVisible = false }; overlay.Children.Add(toastLayer);
            var all = new Grid(); all.Children.Add(root); all.Children.Add(overlay);
            Content = all;
            PaintNav(); PaintSideArtists();
        }
        StackPanel sideFoot;
        public static FrameworkElement LogoMark(double size)
        {
            var g = new Grid { Width = size, Height = size };
            g.Children.Add(new Border { CornerRadius = Ui.CR(size * 0.23), Background = new LinearGradientBrush(Ui.C(0x2A221E), Ui.C(0x110D0B), 90), BorderBrush = Ui.Br(Ui.A(Colors.White, 0x18)), BorderThickness = new Thickness(1) });
            var cv = new Canvas { Width = 512, Height = 512 };
            var clip = Geometry.Parse("M190 150 L190 362 L374 256 Z");
            var bars = new GeometryGroup();
            foreach (var y in new[] { new[] { 124, 38 }, new[] { 176, 38 }, new[] { 228, 56 }, new[] { 298, 38 }, new[] { 350, 38 } }) bars.Children.Add(new RectangleGeometry(new Rect(150, y[0], 260, y[1])));
            var tri = new Path { Data = clip, Stroke = Brushes.White, StrokeThickness = 44, StrokeLineJoin = PenLineJoin.Round, Fill = Brushes.White };
            var shape = new Path { Data = bars, Fill = new LinearGradientBrush(Ui.C(0xFF7448), Ui.C(0xF03C1C), 90) };
            shape.OpacityMask = new VisualBrush(tri) { Stretch = Stretch.None, ViewboxUnits = BrushMappingMode.Absolute, Viewbox = new Rect(0, 0, 512, 512), ViewportUnits = BrushMappingMode.Absolute, Viewport = new Rect(0, 0, 512, 512), AlignmentX = AlignmentX.Left, AlignmentY = AlignmentY.Top };
            var holder = new Canvas { Width = 512, Height = 512 }; holder.Children.Add(shape);
            g.Children.Add(new Viewbox { Child = holder, Margin = new Thickness(0) });
            return g;
        }
        static readonly string[][] TABS = { new[] { "home", "Главная", "home" }, new[] { "lib", "Библиотека", "library" } };
        void PaintNav()
        {
            nav.Children.Clear(); sideFoot.Children.Clear();
            foreach (var t in TABS) nav.Children.Add(NavItem(t[0], t[1], t[2]));
            sideFoot.Children.Add(NavItem("settings", "Настройки", "gear"));
        }
        Border NavItem(string id, string label, string icon)
        {
            bool on = id == tab;
            var sp = new StackPanel { Orientation = Orientation.Horizontal };
            var ic = Ui.Icon(icon, 22, on ? Ui.Accent : Ui.MUTED); sp.Children.Add(ic);
            var tx = Ui.Text(label, 14.5, on ? Ui.TEXT : Ui.MUTED, true); tx.Margin = new Thickness(14, 0, 0, 0); tx.VerticalAlignment = VerticalAlignment.Center; sp.Children.Add(tx);
            var b = new Border { Height = 46, Padding = new Thickness(14, 0, 14, 0), CornerRadius = Ui.CR(Ui.Square ? 0 : 12), Background = Ui.Br(on ? Ui.NavOn : Colors.Transparent), Child = sp, Margin = new Thickness(0, 0, 0, 4), BorderBrush = Ui.Br(Ui.Accent), BorderThickness = new Thickness(on && Ui.Square ? 3 : 0, 0, 0, 0) };
            sp.VerticalAlignment = VerticalAlignment.Center;
            return Ui.Click(b, () => { if (id == tab && stack.Count > 1) { while (stack.Count > 1) stack.RemoveAt(stack.Count - 1); ShowTop(); } else ShowTab(id); }, on ? Ui.NavOn : Ui.A(Colors.White, 0x0C));
        }
        void ShowTab(string id)
        {
            tab = id; stack.Clear();
            FrameworkElement v;
            if (!roots.TryGetValue(id, out v) || id == "settings") { v = Build(id); roots[id] = v; }
            stack.Add(new KeyValuePair<string, FrameworkElement>(id, v)); ShowTop(); PaintNav();
        }
        FrameworkElement Build(string id)
        {
            if (id == "lib") return LibPage();
            if (id == "settings") return SettingsPage();
            if (id == "search") return SearchPage();
            return HomePage();
        }
        void Push(string key, FrameworkElement v) { stack.Add(new KeyValuePair<string, FrameworkElement>(key, v)); ShowTop(); }
        void ShowTop()
        {
            var v = stack[stack.Count - 1].Value;
            var parent = v.Parent as Panel; if (parent != null) parent.Children.Remove(v);
            pageHost.Children.Clear(); pageHost.Children.Add(v);
            v.Opacity = 0; var tt = new TranslateTransform(0, 10); v.RenderTransform = tt;
            Ui.Fade(v, 1, 160);
            tt.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(0, TimeSpan.FromMilliseconds(220)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
        }
        bool Back()
        {
            if (dialogLayer.Visibility == Visibility.Visible) { CloseDialog(); return true; }
            if (npOpen) { CloseNP(); return true; }
            if (stack.Count > 1) { stack.RemoveAt(stack.Count - 1); ShowTop(); return true; }
            if (tab != "home") { ShowTab("home"); return true; }
            return false;
        }
        void OnKey(object sender, KeyEventArgs e)
        {
            bool inText = Keyboard.FocusedElement is TextBox;
            if (e.Key == Key.Escape) { if (inText) { Keyboard.ClearFocus(); FocusManager.SetFocusedElement(this, this); } else Back(); e.Handled = true; return; }
            if (e.Key == Key.F11) { ToggleFullscreen(); e.Handled = true; return; }
            if (e.Key == Key.F9) { try { System.IO.File.AppendAllText(System.IO.Path.Combine(Program.Data, "errors.log"), "LY shift=" + lyShift.Y + " panelH=" + lyPanel.ActualHeight + " boxH=" + lyBox.ActualHeight + " boxW=" + lyBox.ActualWidth + " lines=" + ly.Count + " last=" + lyLast + " kids=" + lyPanel.Children.Count + " vis=" + lyBox.Visibility + " panelW=" + lyPanel.ActualWidth + " op=" + lyPanel.Opacity + Environment.NewLine); } catch { } return; }
            if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.F) { searchBox.Focus(); searchBox.SelectAll(); e.Handled = true; return; }
            if (inText) return;
            if (e.Key == Key.Space) { P.Toggle(); e.Handled = true; }
            else if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.Right) P.Next(false);
            else if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.Left) P.Prev();
            else if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.L) { OpenNP(); SetPane("lyrics"); }
            else if (e.Key == Key.BrowserBack || (Keyboard.Modifiers == ModifierKeys.Alt && e.SystemKey == Key.Left)) Back();
        }

        // ═════════ building blocks ═════════
        StackPanel PageBody() { return new StackPanel { Margin = new Thickness(36, 6, 36, 40) }; }
        FrameworkElement Header(string small, string title)
        {
            var sp = new StackPanel { Margin = new Thickness(0, 4, 0, 18) };
            if (small != null) { var s = Ui.Text(small.ToUpperInvariant(), 11.5, Ui.Accent, true); s.Margin = new Thickness(0, 0, 0, 8); sp.Children.Add(s); }
            var t = Ui.Text(title, 38, Ui.TEXT, true, true); t.FontWeight = FontWeights.Bold; sp.Children.Add(t);
            return sp;
        }
        FrameworkElement SectionTitle(string s) { var t = Ui.Text(s, 21, Ui.TEXT, true, true); t.FontWeight = FontWeights.Bold; t.Margin = new Thickness(0, 22, 0, 12); return t; }
        FrameworkElement Note(string s) { var t = Ui.Wrap(s, 14, Ui.MUTED); t.HorizontalAlignment = HorizontalAlignment.Center; t.TextAlignment = TextAlignment.Center; t.Margin = new Thickness(20, 34, 20, 34); return t; }
        FrameworkElement Loading() { return Note("Загружаю…"); }
        Border Banner(string icon, string title, string sub, string btn, Action onClick)
        {
            var g = new Grid(); g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); g.ColumnDefinitions.Add(new ColumnDefinition()); g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var ic = Ui.Icon(icon, 24, Ui.Accent); ic.VerticalAlignment = VerticalAlignment.Center; g.Children.Add(ic);
            var tx = new StackPanel { Margin = new Thickness(14, 0, 14, 0), VerticalAlignment = VerticalAlignment.Center };
            tx.Children.Add(Ui.Text(title, 14.5, Ui.TEXT, true)); var st = Ui.Wrap(sub, 12.5, Ui.MUTED); st.Margin = new Thickness(0, 3, 0, 0); tx.Children.Add(st);
            Grid.SetColumn(tx, 1); g.Children.Add(tx);
            if (btn != null) { var b = Ui.Pill(btn, true, onClick); b.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(b, 2); g.Children.Add(b); }
            return new Border { Child = g, Padding = new Thickness(16, 12, 12, 12), CornerRadius = Ui.CR(16), Background = Ui.Br(Ui.SURF), BorderBrush = Ui.Br(Ui.A(Ui.Accent, 0x40)), BorderThickness = new Thickness(1), Margin = new Thickness(0, 10, 0, 0) };
        }

        /// <summary>A track row: number / cover / title + source + artist / duration / ⋯</summary>
        FrameworkElement Row(Track t, List<Track> list, int i, string name, Dictionary<string, object> pl, bool number = true)
        {
            bool on = P.Cur != null && P.Cur.Key == t.Key;
            var g = new Grid { Height = 58 };
            if (number) g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(34) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(48) });
            g.ColumnDefinitions.Add(new ColumnDefinition());
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            int c = 0;
            if (number) { var n = Ui.Text(on ? "♪" : (i + 1).ToString(), 12.5, on ? Ui.Accent : Ui.FAINT); n.HorizontalAlignment = HorizontalAlignment.Center; n.VerticalAlignment = VerticalAlignment.Center; g.Children.Add(n); c++; }
            var cv = Ui.Cover(t.Art, 46, 46, 8); cv.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(cv, c++); g.Children.Add(cv);
            var m = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(14, 0, 12, 0) };
            m.Children.Add(Ui.Text(t.Title, 14.5, on ? Ui.Accent : Ui.TEXT, true));
            var sub = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 0) };
            sub.Children.Add(Ui.Badge(t.Src, t.Kind)); var ar = Ui.Text(t.Artist, 12.5, Ui.MUTED); ar.Margin = new Thickness(7, 0, 0, 0); ar.VerticalAlignment = VerticalAlignment.Center; sub.Children.Add(ar);
            m.Children.Add(sub);
            Grid.SetColumn(m, c++); g.Children.Add(m);
            var d = Ui.Text(t.Duration > 0 ? Ui.Fmt(t.Duration) : t.DurText, 12.5, Ui.FAINT); d.VerticalAlignment = VerticalAlignment.Center; d.Margin = new Thickness(0, 0, 10, 0); Grid.SetColumn(d, c++); g.Children.Add(d);
            var dots = Ui.IconButton("dots", 36, 18, Ui.MUTED, Colors.Transparent, () => TrackMenu(t, pl), "Ещё"); dots.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(dots, c++); g.Children.Add(dots);
            var row = new Border { Child = g, CornerRadius = Ui.CR(10), Padding = new Thickness(6, 0, 6, 0), Background = Ui.Br(on ? Ui.A(Ui.Accent, 0x22) : Colors.Transparent) };
            Ui.Click(row, () => { if (t.Playable) PlayList(list, i, name); else if (t.Browse != null) OpenBrowse(t.Browse, t.Title, t.Art); }, Ui.A(Colors.White, 0x0C));
            row.MouseRightButtonUp += (s, e) => TrackMenu(t, pl);
            return row;
        }
        /// <summary>Adds rows in batches as the page scrolls, so long lists open instantly.</summary>
        void Rows(StackPanel host, List<Track> list, string name, Dictionary<string, object> pl, ScrollViewer sv, bool number = true)
        {
            int shown = 0;
            Action more = () => { int end = Math.Min(list.Count, shown + 60); for (; shown < end; shown++) host.Children.Add(Row(list[shown], list, shown, name, pl, number)); };
            more();
            if (sv != null && list.Count > shown) sv.ScrollChanged += (s, e) => { if (shown < list.Count && sv.VerticalOffset > sv.ScrollableHeight - 900) more(); };
        }
        FrameworkElement Cards(List<Track> items, string name)
        {
            var sp = new StackPanel { Orientation = Orientation.Horizontal };
            foreach (var t0 in items)
            {
                var t = t0;
                var c = new StackPanel { Width = 168 };
                var cv = Ui.Cover(t.Art, 168, 168, t.Round ? 84 : 14);
                c.Children.Add(cv);
                var a = Ui.Text(t.Title, 14, Ui.TEXT, true); a.Margin = new Thickness(0, 10, 0, 0); c.Children.Add(a);
                var b = Ui.Text(t.Artist, 12.5, Ui.MUTED); b.Margin = new Thickness(0, 3, 0, 0); c.Children.Add(b);
                var card = new Border { Child = c, Padding = new Thickness(8), CornerRadius = Ui.CR(16), Margin = new Thickness(0, 0, 6, 0), Background = Ui.Br(Colors.Transparent) };
                Ui.Click(card, () =>
                {
                    if (t.Playable) { var songs = items.Where(x => x.Playable).ToList(); PlayList(songs, songs.IndexOf(t), name); }
                    else if (t.Browse != null) OpenBrowse(t.Browse, t.Title, t.Art);
                }, Ui.A(Colors.White, 0x0A));
                card.MouseRightButtonUp += (s, e) => { if (t.Playable) TrackMenu(t, null); };
                sp.Children.Add(card);
            }
            var sv = Ui.Scroll(sp, true); sv.Margin = new Thickness(-8, 0, -8, 0);
            return sv;
        }
        FrameworkElement Hero(string art, string icon, Color coverBg, string small, string title, string sub, params FrameworkElement[] buttons)
        {
            var g = new Grid { Margin = new Thickness(0, 4, 0, 20) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); g.ColumnDefinitions.Add(new ColumnDefinition());
            Border cv;
            if (!string.IsNullOrEmpty(art)) cv = Ui.Cover(art, 210, 210, 18);
            else
            {
                cv = new Border { Width = 210, Height = 210, CornerRadius = Ui.CR(18), Background = new LinearGradientBrush(coverBg, Ui.Darken(coverBg, 0.45), 45) };
                var ic = Ui.Icon(icon, 72, Colors.White); ic.HorizontalAlignment = HorizontalAlignment.Center; ic.VerticalAlignment = VerticalAlignment.Center; cv.Child = ic;
            }
            cv.Effect = new System.Windows.Media.Effects.DropShadowEffect { BlurRadius = 40, ShadowDepth = 10, Opacity = 0.45, Color = Colors.Black };
            g.Children.Add(cv);
            var r = new StackPanel { VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(28, 0, 0, 4) };
            var s = Ui.Text(small.ToUpperInvariant(), 11.5, Ui.Accent, true); r.Children.Add(s);
            var t = Ui.Text(title, 40, Ui.TEXT, true, true); t.FontWeight = FontWeights.Bold; t.Margin = new Thickness(0, 6, 0, 0); r.Children.Add(t);
            if (sub != null) { var st = Ui.Text(sub, 13.5, Ui.MUTED); st.Margin = new Thickness(0, 6, 0, 0); r.Children.Add(st); }
            var br = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 18, 0, 0) };
            foreach (var b in buttons) { b.Margin = new Thickness(0, 0, 10, 0); br.Children.Add(b); }
            r.Children.Add(br);
            Grid.SetColumn(r, 1); g.Children.Add(r);
            return g;
        }

        // ═════════ Главная ═════════
        StackPanel homeBody;
        FrameworkElement HomePage()
        {
            var body = PageBody();
            int h = DateTime.Now.Hour;
            body.Children.Add(Header(h < 6 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер", "Главная"));
            homeBody = new StackPanel(); body.Children.Add(homeBody);
            if (!Online) { PaintOffline(); return Ui.Scroll(body); }
            PaintHome(Store.Obj("home"));
            LoadHome();
            return Ui.Scroll(body);
        }
        async void PaintOffline()
        {
            homeBody.Children.Clear();
            homeBody.Children.Add(Banner("wifi", "Нет интернета", "YouTube Music и SoundCloud недоступны без сети. Музыка с компьютера играет как обычно.", "Моя музыка", OpenLocal));
            var l = await LocalTracks();
            if (l.Count == 0) { homeBody.Children.Add(Note("В папке «" + Engine.MusicFolder() + "» нет аудиофайлов. Выберите папку в «Настройках»")); return; }
            homeBody.Children.Add(SectionTitle("Моя музыка"));
            var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 10) };
            row.Children.Add(Ui.Pill("Слушать всё", true, () => PlayList(l, 0, "Моя музыка"), "play"));
            var sh = Ui.Pill("Перемешать", false, () => PlayList(Shuffled(l), 0, "Моя музыка"), "shuffle"); sh.Margin = new Thickness(10, 0, 0, 0); row.Children.Add(sh);
            homeBody.Children.Add(row);
            var top = l.Take(30).ToList(); for (int k = 0; k < top.Count; k++) homeBody.Children.Add(Row(top[k], l, k, "Моя музыка", null));
        }
        async void LoadHome()
        {
            var d = await E.Eng("home");
            if (J.A(d, "sections").Count > 0) { Store.Set("home", d); PaintHome(d); }
            else if (Store.Obj("home") == null) PaintHome(null);
        }
        void PaintHome(Dictionary<string, object> d)
        {
            if (homeBody == null) return;
            homeBody.Children.Clear();
            var recent = Track.List(Store.List("recent"), "yt");
            if (recent.Count > 0) { homeBody.Children.Add(SectionTitle("Недавно играло")); homeBody.Children.Add(Cards(recent, "Недавно играло")); }
            if (d == null) { homeBody.Children.Add(Loading()); return; }
            foreach (var s in J.A(d, "sections"))
            {
                var title = J.S(s, "title"); if (title.Length == 0) title = "Для вас";
                var items = Track.List(J.A(s, "items"), "yt").Where(x => !IsDisliked(x)).ToList();
                if (items.Count == 0) continue;
                homeBody.Children.Add(SectionTitle(title));
                if (J.S(s, "layout") == "cards") homeBody.Children.Add(Cards(items, title));
                else { var top = items.Take(6).ToList(); for (int k = 0; k < top.Count; k++) homeBody.Children.Add(Row(top[k], top, k, title, null, false)); }
            }
        }

        // ═════════ Поиск ═════════
        StackPanel searchBody; string searchFilter = "all", lastQ = ""; List<Track> sYt, sSc, sLocal = new List<Track>(), sMore = new List<Track>(); int searchSeq;
        FrameworkElement SearchPage()
        {
            var body = PageBody();
            body.Children.Add(Header("YouTube Music · SoundCloud · файлы", lastQ.Length > 0 ? lastQ : "Поиск"));
            searchBody = new StackPanel(); body.Children.Add(searchBody);
            return Ui.Scroll(body);
        }
        readonly Dictionary<string, KeyValuePair<DateTime, Dictionary<string, object>>> pageCache = new Dictionary<string, KeyValuePair<DateTime, Dictionary<string, object>>>();
        async Task<Dictionary<string, object>> Cached(string key, Func<Task<Dictionary<string, object>>> load)
        {
            KeyValuePair<DateTime, Dictionary<string, object>> hit;
            if (pageCache.TryGetValue(key, out hit) && (DateTime.Now - hit.Key).TotalMinutes < 15) return hit.Value;
            var d = await load();
            if (!J.Has(d, "error")) pageCache[key] = new KeyValuePair<DateTime, Dictionary<string, object>>(DateTime.Now, d);
            return d;
        }
        async void DoSearch(string q)
        {
            lastQ = q; var my = ++searchSeq;
            sYt = null; sSc = null; sMore = new List<Track>();
            sLocal = (await LocalTracks()).Where(t => (t.Title + " " + t.Artist).IndexOf(q, StringComparison.CurrentCultureIgnoreCase) >= 0).ToList();
            if (my != searchSeq) return;
            roots.Remove("search");
            if (tab != "search") { tab = "search"; PaintNav(); }
            stack.Clear(); var page = SearchPage(); roots["search"] = page; stack.Add(new KeyValuePair<string, FrameworkElement>("search", page)); ShowTop();
            PaintSearch(q);
            if (!Online) { sYt = new List<Track>(); sSc = new List<Track>(); PaintSearch(q); return; }
            var yt = Cached("search:" + q.ToLowerInvariant(), () => E.Eng("search", "q", q));
            var sc = E.Soundcloud("search", q);
            var y = await yt; if (my != searchSeq) return;
            sYt = Track.List(J.A(y, "tracks"), "yt"); sMore = Track.List(J.A(y, "more"), "yt"); PaintSearch(q);
            var c = await sc; if (my != searchSeq) return;
            sSc = Track.List(J.A(c, "items"), "sc"); foreach (var t in sSc) t.Src = "sc"; PaintSearch(q);
        }
        void PaintSearch(string q)
        {
            if (searchBody == null) return;
            searchBody.Children.Clear();
            var chips = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 6) };
            foreach (var f in new[] { new[] { "all", "Всё" }, new[] { "yt", "YouTube Music" }, new[] { "sc", "SoundCloud" }, new[] { "local", "Файлы" } })
            {
                var id = f[0]; int n = id == "yt" ? (sYt == null ? -1 : sYt.Count) : id == "sc" ? (sSc == null ? -1 : sSc.Count) : id == "local" ? sLocal.Count : -2;
                chips.Children.Add(Ui.Chip(f[1] + (n >= 0 ? "  " + n : n == -1 ? "  …" : ""), id == searchFilter, () => { searchFilter = id; PaintSearch(q); }));
            }
            searchBody.Children.Add(chips);
            if ((searchFilter == "all" || searchFilter == "yt") && sMore.Count > 0) { searchBody.Children.Add(SectionTitle("Альбомы и исполнители")); searchBody.Children.Add(Cards(sMore.Take(14).ToList(), q)); }
            var a = searchFilter == "sc" || searchFilter == "local" || sYt == null ? new List<Track>() : sYt;
            var b = searchFilter == "yt" || searchFilter == "local" || sSc == null ? new List<Track>() : sSc;
            var merged = new List<Track>();
            for (int i = 0; i < Math.Max(a.Count, b.Count); i++) { if (i < a.Count && !IsDisliked(a[i])) merged.Add(a[i]); if (i < b.Count && !IsDisliked(b[i])) merged.Add(b[i]); }
            if (searchFilter == "local") merged.AddRange(sLocal); else if (searchFilter == "all") merged.AddRange(sLocal.Take(5));
            if (merged.Count > 0) searchBody.Children.Add(SectionTitle("Треки"));
            for (int i = 0; i < merged.Count; i++) searchBody.Children.Add(Row(merged[i], merged, i, "Поиск: " + q, null));
            if (merged.Count == 0) searchBody.Children.Add(sYt == null || sSc == null ? Loading() : Note("Ничего не нашлось"));
        }

        // ═════════ Библиотека ═════════
        Dictionary<string, object> plYt, plSc; DateTime plAt = DateTime.MinValue; Task plTask; string libFilter = "all"; StackPanel libBody;
        FrameworkElement LibPage()
        {
            var body = PageBody();
            body.Children.Add(Header("Всё в одном месте", "Библиотека"));
            libBody = new StackPanel(); body.Children.Add(libBody);
            PaintLib(); if (Online) LoadRemote(false); else plAt = DateTime.Now;
            return Ui.Scroll(body);
        }
        Task LoadRemote(bool force)
        {
            if (plTask != null && !plTask.IsCompleted) return plTask;
            if (!force && plAt != DateTime.MinValue && (DateTime.Now - plAt).TotalMinutes < 5) return Task.FromResult(0);
            plTask = LoadRemoteNow();
            return plTask;
        }
        async Task LoadRemoteNow()
        {
            var y = E.Eng("playlists"); var c = E.Soundcloud("sets", "");
            plYt = await y; plSc = await c;
            if (J.Has(plSc, "login")) { scLogin = J.B(plSc, "login"); scChecked = true; }
            plAt = DateTime.Now; PaintLib();
        }
        void PaintLib()
        {
            if (libBody == null) return;
            libBody.Children.Clear();
            var chips = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 16) };
            foreach (var f in new[] { new[] { "all", "Всё" }, new[] { "yp", "YouPlay" }, new[] { "yt", "YouTube Music" }, new[] { "sc", "SoundCloud" } }) { var id = f[0]; chips.Children.Add(Ui.Chip(f[1], id == libFilter, () => { libFilter = id; PaintLib(); })); }
            chips.Children.Add(Ui.IconButton("update", 32, 16, Ui.MUTED, Ui.S2, () => { Toast("Обновляю плейлисты…"); LoadRemote(true); }, "Обновить"));
            libBody.Children.Add(chips);
            var wrap = new WrapPanel();
            wrap.Children.Add(Tile(null, "plus", Ui.S2, "Новый плейлист", "YouPlay, YouTube Music или SoundCloud", null, () => CreatePlaylist(null), true));
            if (libFilter == "all" || libFilter == "yp")
            {
                wrap.Children.Add(Tile(null, "heart", Ui.Accent, "Любимое", "Лайки YouTube Music и SoundCloud", null, OpenLikes, false));
                wrap.Children.Add(Tile(null, "music", Ui.C(0x3A332F), "Моя музыка", "Файлы · без интернета", null, OpenLocal, false));
                foreach (var p0 in Store.List("playlists")) { var p = p0; var items = J.A(p, "items"); wrap.Children.Add(Tile(FirstArt(items), "library", Ui.S3, J.S(p, "name"), "YouPlay · " + items.Count + " тр.", null, () => OpenPlaylist(J.S(p, "id")), false)); }
            }
            if ((libFilter == "all" || libFilter == "yt") && plYt != null) foreach (var p0 in J.A(plYt, "items")) { var p = p0; wrap.Children.Add(Tile(J.S(p, "art"), "yt", Ui.S3, J.S(p, "title"), J.S(p, "sub").Length > 0 ? J.S(p, "sub") : "YouTube Music", "yt", () => OpenBrowse(J.S(p, "browse"), J.S(p, "title"), J.S(p, "art")), false)); }
            if ((libFilter == "all" || libFilter == "sc") && plSc != null) foreach (var p0 in J.A(plSc, "items")) { var p = p0; wrap.Children.Add(Tile(J.S(p, "art"), "cloud", Ui.S3, J.S(p, "title"), (int)J.D(p, "count") + " тр.", "sc", () => OpenScSet(J.S(p, "url"), J.S(p, "title"), J.S(p, "art")), false)); }
            libBody.Children.Add(wrap);
            if (plAt == DateTime.MinValue) libBody.Children.Add(Note("Загружаю плейлисты из аккаунтов…"));
            bool ytOut = plYt != null && J.Has(plYt, "login") && !J.B(plYt, "login"), scOut = plSc != null && J.Has(plSc, "login") && !J.B(plSc, "login");
            if ((ytOut && libFilter != "sc" && libFilter != "yp") || (scOut && libFilter != "yt" && libFilter != "yp"))
                libBody.Children.Add(Banner("user", "Подключите аккаунты", (ytOut ? "YouTube Music " : "") + (ytOut && scOut ? "и " : "") + (scOut ? "SoundCloud " : "") + "— тогда здесь появятся ваши плейлисты оттуда", "Открыть настройки", () => ShowTab("settings")));
        }
        static string FirstArt(List<Dictionary<string, object>> items) { foreach (var i in items) { var a = J.S(i, "art"); if (a.StartsWith("http")) return a; } return null; }
        FrameworkElement Tile(string art, string icon, Color bg, string title, string sub, string src, Action onClick, bool dashed)
        {
            var c = new StackPanel { Width = 176 };
            var g = new Grid { Width = 176, Height = 176 };
            if (!string.IsNullOrEmpty(art)) g.Children.Add(Ui.Cover(art, 176, 176, 16));
            else
            {
                var bx = new Border { CornerRadius = Ui.CR(16) };
                if (dashed) { bx.BorderBrush = Ui.Br(Ui.S3); bx.BorderThickness = new Thickness(2); bx.Background = Brushes.Transparent; }
                else bx.Background = new LinearGradientBrush(bg, Ui.Darken(bg, 0.45), 45);
                var ic = Ui.Icon(icon, dashed ? 40 : 52, dashed ? Ui.Accent : Colors.White); ic.HorizontalAlignment = HorizontalAlignment.Center; ic.VerticalAlignment = VerticalAlignment.Center; bx.Child = ic;
                g.Children.Add(bx);
            }
            if (src != null) { var b = Ui.Badge(src); b.Background = Ui.Br(Ui.A(Colors.Black, 0xC0)); b.HorizontalAlignment = HorizontalAlignment.Left; b.VerticalAlignment = VerticalAlignment.Bottom; b.Margin = new Thickness(9); g.Children.Add(b); }
            c.Children.Add(g);
            var t = Ui.Text(title, 14, Ui.TEXT, true); t.Margin = new Thickness(0, 10, 0, 0); c.Children.Add(t);
            var s = Ui.Text(sub, 12.5, Ui.MUTED); s.Margin = new Thickness(0, 3, 0, 0); c.Children.Add(s);
            var card = new Border { Child = c, Padding = new Thickness(8), CornerRadius = Ui.CR(18), Margin = new Thickness(0, 0, 10, 12), Background = Ui.Br(Colors.Transparent) };
            return Ui.Click(card, onClick, Ui.A(Colors.White, 0x0A));
        }

        // ═════════ Любимое ═════════
        void OpenLikes()
        {
            var host = new Grid(); Push("likes", host);
            Action paint = null;
            paint = () =>
            {
                var all = MergedLikes();
                var lc = Store.Obj("likes");
                int ny = J.A(lc, "yt").Count, ns = J.A(lc, "sc").Count;
                var body = PageBody(); var sv = Ui.Scroll(body);
                body.Children.Add(Hero(null, "heart", Ui.Accent, "Плейлист", "Любимое", "YouTube Music " + ny + "  ·  SoundCloud " + (scChecked && !scLogin ? "не подключён" : ns.ToString()),
                    Ui.Pill("Слушать", true, () => PlayList(all, 0, "Любимое"), "play"), Ui.Pill("Перемешать", false, () => PlayList(Shuffled(all), 0, "Любимое"), "shuffle"),
                    Ui.Pill(null, false, () => { Toast("Обновляю лайки…"); LoadLikes(true, paint); }, "update")));
                if (E.Ready && !J.B(E.Account, "signedIn")) body.Children.Add(Banner("yt", "Войдите в YouTube Music", "Чтобы здесь появились ваши лайки и сердечко сохраняло треки", "Войти", () => Login("google")));
                if (scChecked && !scLogin) body.Children.Add(Banner("cloud", "Подключите SoundCloud", "Лайки SoundCloud и YouTube Music соберутся в один список по датам", "Войти", () => Login("sc")));
                if (all.Count == 0) body.Children.Add(Note(lc == null ? "Загружаю лайки…" : "Пока пусто. Лайкайте треки сердечком — они появятся здесь."));
                var rows = new StackPanel(); body.Children.Add(rows); Rows(rows, all, "Любимое", null, sv);
                host.Children.Clear(); host.Children.Add(sv);
            };
            paint();
            LoadLikes(false, paint);
        }
        async void LoadLikes(bool force, Action done)
        {
            var lc = Store.Obj("likes");
            if (!force && lc != null && (DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds - J.D(lc, "at") < 10 * 60000) return;
            var y = E.Eng("likes"); var c = E.Soundcloud("likes", "");
            var yr = await y; var cr = await c;
            var outp = lc ?? new Dictionary<string, object>();
            if (J.Has(yr, "tracks")) outp["yt"] = yr["tracks"];
            if (J.Has(cr, "login")) { scLogin = J.B(cr, "login"); scChecked = true; scUser = J.S(cr, "user"); }
            if (J.Has(cr, "items")) outp["sc"] = cr["items"]; else if (J.Has(cr, "login") && !J.B(cr, "login")) outp["sc"] = new object[0];
            outp["at"] = (DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds;
            Store.Set("likes", outp);
            if (done != null) done();
        }
        List<Track> MergedLikes()
        {
            var lc = Store.Obj("likes");
            var yt = Track.List(J.A(lc, "yt"), "yt"); var sc = Track.List(J.A(lc, "sc"), "sc"); foreach (var t in sc) t.Src = "sc";
            var when = new Dictionary<Track, double>(); double oldest = Now();
            foreach (var t in sc) { DateTime dt; double ms = DateTime.TryParse(t.LikedAt, null, System.Globalization.DateTimeStyles.AdjustToUniversal, out dt) ? (dt - new DateTime(1970, 1, 1)).TotalMilliseconds : 0; when[t] = ms; if (ms > 0 && ms < oldest) oldest = ms; }
            double top = Now();
            for (int i = 0; i < yt.Count; i++) when[yt[i]] = top - (yt.Count > 1 ? (double)i / (yt.Count - 1) * (top - oldest) : 0);
            return yt.Concat(sc).OrderByDescending(t => when[t]).Where(t => !IsDisliked(t)).ToList();
        }
        static double Now() { return (DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds; }
        bool ScLiked(string url) { foreach (var x in J.A(Store.Obj("likes"), "sc")) if (url != null && J.S(x, "url") == url) return true; return false; }
        static List<Track> Shuffled(List<Track> l) { var r = new Random(); return l.OrderBy(x => r.Next()).ToList(); }

        // ═════════ Моя музыка ═════════
        List<Track> localCache;
        async Task<List<Track>> LocalTracks(bool force = false)
        {
            if (localCache != null && !force) return localCache;
            localCache = await Task.Run(() => E.ScanLocal());
            return localCache;
        }
        async void OpenLocal()
        {
            var host = new Grid(); Push("local", host);
            host.Children.Add(Ui.Scroll(Loading()));
            var l = await LocalTracks(true);
            var body = PageBody(); var sv = Ui.Scroll(body);
            body.Children.Add(Hero(null, "music", Ui.C(0x3A332F), "Работает без интернета", "Моя музыка", l.Count > 0 ? l.Count + " треков · " + Engine.MusicFolder() : "Папка: " + Engine.MusicFolder(),
                Ui.Pill("Слушать", true, () => PlayList(l, 0, "Моя музыка"), "play"), Ui.Pill("Перемешать", false, () => PlayList(Shuffled(l), 0, "Моя музыка"), "shuffle"), Ui.Pill("Папка…", false, PickFolder)));
            if (l.Count == 0) body.Children.Add(Note("Положите музыку (MP3, M4A, FLAC, OGG, WAV) в папку «Музыка» или выберите другую папку — она появится здесь"));
            var rows = new StackPanel(); body.Children.Add(rows); Rows(rows, l, "Моя музыка", null, sv);
            host.Children.Clear(); host.Children.Add(sv);
        }
        void PickFolder()
        {
            using (var d = new System.Windows.Forms.FolderBrowserDialog { Description = "Папка с музыкой для YouPlay", SelectedPath = Engine.MusicFolder() })
                if (d.ShowDialog() == System.Windows.Forms.DialogResult.OK) { Store.Set("musicFolder", d.SelectedPath); localCache = null; if (stack.Count > 0 && stack[stack.Count - 1].Key == "local") { stack.RemoveAt(stack.Count - 1); OpenLocal(); } }
        }

        // ═════════ pages: YouTube album / playlist / artist, YouPlay playlist, SoundCloud playlist ═════════
        async void OpenBrowse(string href, string title, string art)
        {
            var host = new Grid(); Push("browse", host);
            var b0 = PageBody(); b0.Children.Add(Hero(art, "yt", Ui.S3, "YouTube Music", title, "Загружаю…")); host.Children.Add(Ui.Scroll(b0));
            var d = await Cached("browse:" + href, () => E.Eng("browse", "href", href));
            var l = Track.List(J.A(d, "tracks"), "yt").Where(t => !IsDisliked(t)).ToList();
            var body = PageBody(); var sv = Ui.Scroll(body);
            var t2 = J.S(d, "title"); if (t2.Length == 0) t2 = title;
            body.Children.Add(Hero(string.IsNullOrEmpty(art) ? J.S(d, "art") : art, "yt", Ui.S3, "YouTube Music", t2, J.S(d, "subtitle").Length > 0 ? J.S(d, "subtitle") : l.Count + " треков",
                Ui.Pill("Слушать", true, () => PlayList(l, 0, t2), "play"), Ui.Pill("Перемешать", false, () => PlayList(Shuffled(l), 0, t2), "shuffle")));
            if (l.Count > 0) { var rows = new StackPanel(); body.Children.Add(rows); Rows(rows, l, t2, null, sv); }
            else
            {
                foreach (var s in J.A(d, "sections"))
                {
                    var items = Track.List(J.A(s, "items"), "yt"); if (items.Count == 0) continue;
                    body.Children.Add(SectionTitle(J.S(s, "title")));
                    if (J.S(s, "layout") == "cards") body.Children.Add(Cards(items, J.S(s, "title"))); else for (int k = 0; k < items.Count; k++) body.Children.Add(Row(items[k], items, k, J.S(s, "title"), null));
                }
                if (J.A(d, "sections").Count == 0) body.Children.Add(Note("Здесь пока пусто"));
            }
            host.Children.Clear(); host.Children.Add(sv);
        }
        Dictionary<string, object> FindPlaylist(string id) { return Store.List("playlists").FirstOrDefault(p => J.S(p, "id") == id); }
        Grid plHost; string plOpen;
        void OpenPlaylist(string id) { plHost = new Grid(); plOpen = id; Push("pl", plHost); PaintPlaylist(); }
        void PaintPlaylist()
        {
            if (plHost == null || plOpen == null) return;
            var p = FindPlaylist(plOpen); if (p == null) return;
            var l = Track.List(J.A(p, "items"), "yt").Where(t => !IsDisliked(t)).ToList();
            var name = J.S(p, "name");
            int ny = l.Count(t => t.Src == "yt"), ns = l.Count(t => t.Src == "sc"), nl = l.Count(t => t.Src == "local");
            var body = PageBody(); var sv = Ui.Scroll(body);
            body.Children.Add(Hero(FirstArt(J.A(p, "items")), "library", Ui.S3, "Плейлист YouPlay", name, l.Count + " тр." + (ny > 0 ? " · YouTube " + ny : "") + (ns > 0 ? " · SoundCloud " + ns : "") + (nl > 0 ? " · файлы " + nl : ""),
                Ui.Pill("Слушать", true, () => PlayList(l, 0, name), "play"), Ui.Pill("Перемешать", false, () => PlayList(Shuffled(l), 0, name), "shuffle"),
                Ui.Pill("Переименовать", false, () => AskText("Название плейлиста", name, v => { p["name"] = v; SavePlaylist(p); PaintPlaylist(); roots.Remove("lib"); })),
                Ui.Pill("Удалить", false, () => Confirm("Удалить плейлист «" + name + "»?", "Треки останутся в YouTube Music и SoundCloud, удалится только этот список.", "Удалить", () => { DeletePlaylist(J.S(p, "id")); plOpen = null; Back(); Toast("Плейлист удалён"); }))));
            if (l.Count == 0) body.Children.Add(Note("Пока пусто. Нажмите ⋯ у любого трека → «Добавить в плейлист»."));
            var rows = new StackPanel(); body.Children.Add(rows); Rows(rows, l, name, p, sv);
            plHost.Children.Clear(); plHost.Children.Add(sv);
        }
        async void OpenScSet(string url, string title, string art)
        {
            var host = new Grid(); Push("scset", host);
            var b0 = PageBody(); b0.Children.Add(Hero(art, "cloud", Ui.S3, "SoundCloud", title, "Загружаю…")); host.Children.Add(Ui.Scroll(b0));
            var d = await E.Soundcloud("set", url);
            var l = Track.List(J.A(d, "items"), "sc"); foreach (var t in l) t.Src = "sc"; l = l.Where(t => !IsDisliked(t)).ToList();
            var body = PageBody(); var sv = Ui.Scroll(body);
            body.Children.Add(Hero(art, "cloud", Ui.S3, "Плейлист SoundCloud", title, l.Count + " тр.", Ui.Pill("Слушать", true, () => PlayList(l, 0, title), "play"), Ui.Pill("Перемешать", false, () => PlayList(Shuffled(l), 0, title), "shuffle")));
            if (l.Count == 0) body.Children.Add(Note("Не удалось открыть плейлист SoundCloud"));
            var rows = new StackPanel(); body.Children.Add(rows); Rows(rows, l, title, null, sv);
            host.Children.Clear(); host.Children.Add(sv);
        }

        // ═════════ playlists storage ═════════
        void SavePlaylist(Dictionary<string, object> p) { var all = Store.List("playlists"); for (int i = 0; i < all.Count; i++) if (J.S(all[i], "id") == J.S(p, "id")) all[i] = p; Store.SetList("playlists", all); }
        void DeletePlaylist(string id) { Store.SetList("playlists", Store.List("playlists").Where(p => J.S(p, "id") != id).ToList()); roots.Remove("lib"); }
        bool PlHas(Dictionary<string, object> p, Track t) { return J.A(p, "items").Any(x => Track.From(x, "yt").Key == t.Key); }
        void AddTo(Dictionary<string, object> p, Track t) { var items = J.A(p, "items"); items.Add(t.Json()); p["items"] = items.ToArray(); SavePlaylist(p); roots.Remove("lib"); }
        void RemoveFrom(Dictionary<string, object> p, Track t) { p["items"] = J.A(p, "items").Where(x => Track.From(x, "yt").Key != t.Key).ToArray(); SavePlaylist(p); PaintPlaylist(); roots.Remove("lib"); Toast("Убрано из плейлиста"); }

        // ═════════ likes / dislikes ═════════
        public bool IsDisliked(Track t) { var k = t.Key; return Store.List("disliked").Any(d => J.S(d, "key") == k); }
        void Like()
        {
            var t = P.Cur; if (t == null) return;
            if (t.Src == "yt") { E.Control("like"); Toast(t.Liked ? "Убрано из понравившихся" : "♥ Сохранено в YouTube Music"); t.Liked = !t.Liked; var lc = Store.Obj("likes"); if (lc != null) { lc["at"] = 0; Store.Save(); } PaintNP(); }
            else if (t.Src == "sc") LikeSc(t);
            else { var f = J.Strs(Store.Data, "localFav"); if (f.Contains(t.Id)) f.Remove(t.Id); else f.Add(t.Id); Store.Set("localFav", f.ToArray()); PaintNP(); }
        }
        bool LikedNow() { var t = P.Cur; if (t == null) return false; if (t.Src == "sc") return ScLiked(t.Url); if (t.Src == "local") return J.Strs(Store.Data, "localFav").Contains(t.Id); return t.Liked; }
        async void LikeSc(Track t)
        {
            bool liked = ScLiked(t.Url);
            Toast(liked ? "Убираю лайк…" : "Ставлю лайк в SoundCloud…");
            var r = await E.Soundcloud(liked ? "unlike" : "like", t.Url);
            if (J.Has(r, "login") && !J.B(r, "login")) { Toast("Войдите в SoundCloud в настройках"); return; }
            if (!J.B(r, "ok")) { Toast("SoundCloud не принял лайк — попробуйте ещё раз"); return; }
            var lc = Store.Obj("likes") ?? new Dictionary<string, object>();
            var list = J.A(lc, "sc").Where(x => J.S(x, "url") != t.Url).ToList();
            if (!liked) { var o = t.Json(); o["likedAt"] = DateTime.UtcNow.ToString("o"); list.Insert(0, o); }
            lc["sc"] = list.ToArray(); Store.Set("likes", lc);
            Toast(liked ? "Убрано из лайков SoundCloud" : "♥ Сохранено в SoundCloud"); PaintNP();
        }
        void Dislike(Track t)
        {
            if (t == null) return;
            var all = Store.List("disliked");
            if (IsDisliked(t)) { Store.SetList("disliked", all.Where(d => J.S(d, "key") != t.Key).ToList()); Toast("Снова можно предлагать"); PaintNP(); return; }
            var o = t.Json(); o["key"] = t.Key; all.Insert(0, o); Store.SetList("disliked", all);
            bool isCur = P.Cur != null && P.Cur.Key == t.Key;
            if (isCur && t.Src == "yt") E.Control("dislike");
            Toast("Больше не предложу: " + t.Title);
            if (isCur) P.Next(false);
        }

        // ═════════ Настройки ═════════
        FrameworkElement SettingsPage()
        {
            var body = PageBody(); body.MaxWidth = 860; body.HorizontalAlignment = HorizontalAlignment.Left;
            body.Children.Add(Header(null, "Настройки"));
            body.Children.Add(SetTitle("Аккаунты"));
            bool yIn = J.B(E.Account, "signedIn");
            body.Children.Add(AccRow("yt", Ui.YT, "YouTube Music", !E.Ready ? "Подключаюсь…" : yIn ? "✓ Вход выполнен" : "Вход не выполнен", yIn ? "Сменить" : "Войти", () => Login("google")));
            body.Children.Add(AccRow("cloud", Ui.SC, "SoundCloud", !scChecked ? "Проверяю…" : scLogin ? "✓ " + (scUser.Length > 0 ? scUser : "Подключён") : "Вход не выполнен", scLogin ? "Выйти" : "Войти", async () => { if (scLogin) { await E.ScLogout(); scLogin = false; var lc = Store.Obj("likes"); if (lc != null) { lc["sc"] = new object[0]; Store.Save(); } ShowTab("settings"); } else Login("sc"); }));
            if (!scChecked) CheckSc();
            body.Children.Add(SetTitle("Тема"));
            body.Children.Add(ThemePicker());
            body.Children.Add(SetTitle("Цвет акцента"));
            var acc = new StackPanel { Orientation = Orientation.Horizontal };
            foreach (var col0 in new[] { 0xFF5A36, 0xFF3D6E, 0xFFB020, 0x2BC48A, 0x22B8E6, 0x4A7DFF, 0x9B6BFF, 0xE6E1DC })
            {
                var col = col0; var c = Ui.C(col);
                var dot = new Border { Width = 34, Height = 34, CornerRadius = Ui.CR(17), Background = Ui.Br(c), Margin = new Thickness(0, 0, 10, 0), BorderBrush = Ui.Br(Ui.TEXT), BorderThickness = new Thickness(c == Ui.Accent ? 3 : 0) };
                Ui.Click(dot, () => { Ui.Accent = c; Store.Set("accent", col); RebuildAll(); }, c);
                acc.Children.Add(dot);
            }
            body.Children.Add(acc);
            body.Children.Add(SetTitle("Звук"));
            body.Children.Add(AccRow("volume", Ui.Accent, "Эквалайзер", Store.Bool("eqOn", false) ? "Включён · " + Store.Get("eqPreset", "Свой") : "Выключен", "Настроить", OpenEqualizer));
            body.Children.Add(SetTitle("Воспроизведение"));
            body.Children.Add(Toggle("autoNP", true, "Открывать плеер на весь экран при запуске трека", "Обложка, текст по словам и очередь"));
            body.Children.Add(Toggle("adblock", true, "Блокировка рекламы", "Реклама в YouTube Music не показывается и не звучит"));
            body.Children.Add(SetTitle("Бета"));
            body.Children.Add(Toggle("clipBg", false, "Клип на фоне (бета)", "В «Сейчас играет» вместо фона играет клип без звука, если он есть у трека. Если клипа нет — остаётся фон в цвет обложки"));
            body.Children.Add(SetTitle("Моя музыка"));
            body.Children.Add(AccRow("music", Ui.LOCAL, "Папка с музыкой", Engine.MusicFolder(), "Выбрать", PickFolder));
            body.Children.Add(SetTitle("Не предлагать"));
            int nd = Store.List("disliked").Count;
            body.Children.Add(AccRow("broken", Ui.MUTED, "Скрытые треки", nd == 0 ? "Пока нет" : nd + " тр. — YouPlay их пропускает", nd > 0 ? "Очистить" : null, () => { Store.SetList("disliked", new List<Dictionary<string, object>>()); ShowTab("settings"); Toast("Список очищен"); }));
            body.Children.Add(SetTitle("Приложение"));
            updLine = Ui.Text(UpdText(), 13, Ui.MUTED);
            body.Children.Add(AccRowEl("update", Ui.Accent, "YouPlay " + Program.Version, updLine, "Проверить", () => { Updater.State = "checking"; updAsked = false; OnUpdateState(); Task.Run(() => { try { Updater.Check(true); } catch { Updater.State = "error"; } Dispatcher.BeginInvoke((Action)OnUpdateState); }); }));
            return Ui.Scroll(body);
        }
        async void CheckSc() { var d = await E.Soundcloud("status", ""); scChecked = true; scLogin = J.B(d, "login"); scUser = J.S(d, "user"); if (tab == "settings" && stack.Count == 1) ShowTab("settings"); }
        async void Login(string service)
        {
            var ok = await E.Login(this, service);
            if (!ok) { Toast("Вход отменён"); return; }
            Toast(service == "sc" ? "SoundCloud подключён" : "Вы вошли в аккаунт Google");
            var lc = Store.Obj("likes"); if (lc != null) { lc["at"] = 0; Store.Save(); }
            if (service == "sc") scChecked = false;
            plAt = DateTime.MinValue; roots.Remove("lib"); roots.Remove("home");
            if (tab == "settings") ShowTab("settings");
        }
        FrameworkElement SetTitle(string s) { var t = Ui.Text(s.ToUpperInvariant(), 11.5, Ui.MUTED, true); t.Margin = new Thickness(4, 24, 0, 10); return t; }
        FrameworkElement AccRow(string icon, Color iconColor, string title, string sub, string btn, Action onClick)
        {
            return AccRowEl(icon, iconColor, title, Ui.Text(sub, 13, sub.StartsWith("✓") ? Ui.LOCAL : Ui.MUTED), btn, onClick);
        }
        FrameworkElement AccRowEl(string icon, Color iconColor, string title, TextBlock sub, string btn, Action onClick)
        {
            var g = new Grid(); g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); g.ColumnDefinitions.Add(new ColumnDefinition()); g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var ic = Ui.Icon(icon, 26, iconColor); ic.VerticalAlignment = VerticalAlignment.Center; g.Children.Add(ic);
            var t = new StackPanel { Margin = new Thickness(16, 0, 12, 0), VerticalAlignment = VerticalAlignment.Center };
            t.Children.Add(Ui.Text(title, 15, Ui.TEXT, true)); sub.Margin = new Thickness(0, 4, 0, 0); t.Children.Add(sub);
            Grid.SetColumn(t, 1); g.Children.Add(t);
            if (btn != null) { var b = Ui.Pill(btn, btn != "Выйти" && btn != "Сменить" && btn != "Очистить", onClick); b.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(b, 2); g.Children.Add(b); }
            return new Border { Child = g, Padding = new Thickness(16, 12, 12, 12), CornerRadius = Ui.CR(16), Background = Ui.Br(Ui.SURF), Margin = new Thickness(0, 0, 0, 8) };
        }
        FrameworkElement Toggle(string key, bool def, string title, string sub)
        {
            bool on = Store.Bool(key, def);
            var g = new Grid(); g.ColumnDefinitions.Add(new ColumnDefinition()); g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var t = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            t.Children.Add(Ui.Text(title, 15, Ui.TEXT, true)); var s = Ui.Text(sub, 12.5, Ui.MUTED); s.Margin = new Thickness(0, 4, 0, 0); t.Children.Add(s);
            g.Children.Add(t);
            var knob = new Border { Width = 22, Height = 22, CornerRadius = Ui.CR(11), Background = Brushes.White, HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(3, 0, 0, 0), RenderTransform = new TranslateTransform(on ? 20 : 0, 0) };
            var trackBg = new SolidColorBrush(on ? Ui.Accent : Ui.S3);
            var sw = new Border { Width = 48, Height = 28, CornerRadius = Ui.CR(14), Background = trackBg, Child = knob, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(sw, 1); g.Children.Add(sw);
            var row = new Border { Child = g, Padding = new Thickness(16, 12, 16, 12), CornerRadius = Ui.CR(16), Background = Ui.Br(Ui.SURF), Margin = new Thickness(0, 0, 0, 8) };
            Ui.Click(row, () =>
            {
                on = !on; Store.Set(key, on);
                ((TranslateTransform)knob.RenderTransform).BeginAnimation(TranslateTransform.XProperty, new DoubleAnimation(on ? 20 : 0, TimeSpan.FromMilliseconds(180)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
                trackBg.BeginAnimation(SolidColorBrush.ColorProperty, new ColorAnimation(on ? Ui.Accent : Ui.S3, TimeSpan.FromMilliseconds(180)));
                if (key == "adblock") E.Adblock = on;
            }, Ui.Lighten(Ui.SURF, 0.04));
            return row;
        }
        void RebuildChrome() { PaintNav(); RebuildPlayerBarColors(); }

        // ═════════ window ═════════
        bool isFull; WindowState prevState;
        void ToggleFullscreen()
        {
            if (!isFull) { prevState = WindowState; isFull = true; WindowStyle = WindowStyle.None; WindowState = WindowState.Normal; WindowState = WindowState.Maximized; }
            else { isFull = false; WindowStyle = WindowStyle.SingleBorderWindow; WindowState = prevState; }
        }
        void RestoreBounds_()
        {
            Width = 1280; Height = 820; WindowStartupLocation = WindowStartupLocation.CenterScreen;
            try
            {
                var p = File.ReadAllText(boundsFile).Split(',');
                double x = double.Parse(p[0]), y = double.Parse(p[1]), w = double.Parse(p[2]), h = double.Parse(p[3]);
                if (x > SystemParameters.VirtualScreenLeft - 50 && y > SystemParameters.VirtualScreenTop - 50 && x < SystemParameters.VirtualScreenWidth && w >= 900 && h >= 600)
                { WindowStartupLocation = WindowStartupLocation.Manual; Left = x; Top = y; Width = w; Height = h; }
                if (p.Length > 4 && p[4] == "max") WindowState = WindowState.Maximized;
            }
            catch { if (SystemParameters.WorkArea.Width < 1350 || SystemParameters.WorkArea.Height < 860) WindowState = WindowState.Maximized; }
        }
        void SaveBounds()
        {
            try { var r = WindowState == WindowState.Normal ? new Rect(Left, Top, Width, Height) : RestoreBounds; File.WriteAllText(boundsFile, string.Format(System.Globalization.CultureInfo.InvariantCulture, "{0:0},{1:0},{2:0},{3:0},{4}", r.X, r.Y, r.Width, r.Height, WindowState == WindowState.Maximized ? "max" : "normal")); } catch { }
        }
    }
}
