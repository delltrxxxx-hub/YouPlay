using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Threading;

namespace YouPlay
{
    partial class MainWindow
    {
        Grid dialogLayer, toastLayer;

        // ═════════ dialogs ═════════
        Border OpenDialog(FrameworkElement content, double width = 460)
        {
            var card = new Border { Width = width, MaxHeight = Math.Max(300, ActualHeight - 80), Padding = new Thickness(24, 22, 24, 22), CornerRadius = new CornerRadius(22), Background = Ui.Br(Ui.SURF), BorderBrush = Ui.Br(Ui.A(Colors.White, 0x14)), BorderThickness = new Thickness(1), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Child = content, Effect = new DropShadowEffect { BlurRadius = 60, ShadowDepth = 18, Opacity = 0.55 } };
            card.MouseLeftButtonDown += (s, e) => e.Handled = true;
            dialogLayer.Children.Clear(); dialogLayer.Children.Add(card);
            dialogLayer.Visibility = Visibility.Visible; dialogLayer.Opacity = 0; Ui.Fade(dialogLayer, 1, 160);
            var st = new ScaleTransform(0.94, 0.94); card.RenderTransform = st; card.RenderTransformOrigin = new Point(0.5, 0.5);
            var a = new DoubleAnimation(1, TimeSpan.FromMilliseconds(260)) { EasingFunction = new BackEase { Amplitude = 0.3, EasingMode = EasingMode.EaseOut } };
            st.BeginAnimation(ScaleTransform.ScaleXProperty, a); st.BeginAnimation(ScaleTransform.ScaleYProperty, a);
            return card;
        }
        void CloseDialog() { if (dialogLayer.Visibility != Visibility.Visible) return; Ui.Fade(dialogLayer, 0, 140, () => { dialogLayer.Visibility = Visibility.Collapsed; dialogLayer.Children.Clear(); }); }
        FrameworkElement DialogTitle(string s, bool close = true)
        {
            var g = new Grid { Margin = new Thickness(0, 0, 0, 14) };
            var t = Ui.Text(s, 22, Ui.TEXT, true, true); t.FontWeight = FontWeights.Bold; t.VerticalAlignment = VerticalAlignment.Center; g.Children.Add(t);
            if (close) { var c = Ui.IconButton("close", 34, 18, Ui.MUTED, Colors.Transparent, CloseDialog, "Закрыть"); c.HorizontalAlignment = HorizontalAlignment.Right; g.Children.Add(c); }
            return g;
        }
        Border MenuItem(string icon, string label, Action a)
        {
            var sp = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            sp.Children.Add(Ui.Icon(icon, 21, Ui.MUTED)); var t = Ui.Text(label, 14.5, Ui.TEXT, true); t.Margin = new Thickness(16, 0, 0, 0); t.VerticalAlignment = VerticalAlignment.Center; sp.Children.Add(t);
            return Ui.Click(new Border { Height = 48, Padding = new Thickness(12, 0, 12, 0), CornerRadius = new CornerRadius(12), Background = Ui.Br(Colors.Transparent), Child = sp }, a, Ui.A(Colors.White, 0x10));
        }
        FrameworkElement TrackHead(Track t)
        {
            var g = new Grid { Margin = new Thickness(0, 0, 0, 12) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); g.ColumnDefinitions.Add(new ColumnDefinition());
            g.Children.Add(Ui.Cover(t.Art, 56, 56, 10));
            var m = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(14, 0, 0, 0) };
            m.Children.Add(Ui.Text(t.Title, 16, Ui.TEXT, true));
            var s = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 5, 0, 0) }; s.Children.Add(Ui.Badge(t.Src, t.Kind)); var a = Ui.Text(t.Artist, 12.5, Ui.MUTED); a.Margin = new Thickness(7, 0, 0, 0); a.VerticalAlignment = VerticalAlignment.Center; s.Children.Add(a); m.Children.Add(s);
            Grid.SetColumn(m, 1); g.Children.Add(m);
            return g;
        }
        void TrackMenu(Track t, Dictionary<string, object> pl)
        {
            var sp = new StackPanel();
            sp.Children.Add(TrackHead(t));
            sp.Children.Add(MenuItem("play", "Играть сейчас", () => { CloseDialog(); PlayList(new List<Track> { t }, 0, t.Title); }));
            sp.Children.Add(MenuItem("queue", "Играть следующим", () => { CloseDialog(); P.AddNext(t); Toast("Будет играть следующим: " + t.Title); }));
            sp.Children.Add(MenuItem("plus", "Добавить в плейлист…", () => AddToPlaylist(t)));
            if (t.Src == "yt") sp.Children.Add(MenuItem("user", "Перейти к исполнителю", () => { CloseDialog(); CloseNP(); OpenArtistFor(t); }));
            sp.Children.Add(MenuItem("lyrics", "О треке", () => TrackInfo(t)));
            if (pl != null) sp.Children.Add(MenuItem("close", "Убрать из «" + J.S(pl, "name") + "»", () => { CloseDialog(); RemoveFrom(pl, t); }));
            if (t.Src == "sc") { bool liked = ScLiked(t.Url); sp.Children.Add(MenuItem(liked ? "heart" : "heartLine", liked ? "Убрать лайк в SoundCloud" : "Лайк в SoundCloud", () => { CloseDialog(); LikeSc(t); })); }
            if (t.Src == "yt" && t.VideoId != null) sp.Children.Add(MenuItem("yt", "Открыть в YouTube Music", () => { CloseDialog(); try { Process.Start(new ProcessStartInfo("https://music.youtube.com/watch?v=" + t.VideoId) { UseShellExecute = true }); } catch { } }));
            sp.Children.Add(MenuItem("broken", "Не предлагать этот трек", () => { CloseDialog(); Dislike(t); }));
            OpenDialog(sp, 420);
        }
        void AskText(string title, string value, Action<string> done)
        {
            var sp = new StackPanel();
            sp.Children.Add(DialogTitle(title));
            var box = Field(value, "Название");
            sp.Children.Add(box.Item1);
            var ok = Ui.Pill("Сохранить", true, () => { var v = box.Item2.Text.Trim(); if (v.Length == 0) return; CloseDialog(); done(v); });
            ok.HorizontalAlignment = HorizontalAlignment.Right; ok.Margin = new Thickness(0, 16, 0, 0); sp.Children.Add(ok);
            box.Item2.KeyDown += (s, e) => { if (e.Key == Key.Enter) { var v = box.Item2.Text.Trim(); if (v.Length == 0) return; CloseDialog(); done(v); } };
            OpenDialog(sp, 440);
            Dispatcher.BeginInvoke((Action)(() => { box.Item2.Focus(); box.Item2.SelectAll(); }), DispatcherPriority.Input);
        }
        Tuple<Border, TextBox> Field(string value, string hint)
        {
            var tb = new TextBox { Text = value ?? "", Background = Brushes.Transparent, BorderThickness = new Thickness(0), Foreground = Ui.Br(Ui.TEXT), CaretBrush = Ui.Br(Ui.TEXT), FontSize = 15, VerticalContentAlignment = VerticalAlignment.Center, FontFamily = Ui.Font };
            var h = Ui.Text(hint, 15, Ui.FAINT); h.IsHitTestVisible = false; h.VerticalAlignment = VerticalAlignment.Center; h.Margin = new Thickness(2, 0, 0, 0);
            h.Visibility = tb.Text.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
            tb.TextChanged += (s, e) => h.Visibility = tb.Text.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
            var g = new Grid(); g.Children.Add(h); g.Children.Add(tb);
            var b = new Border { Height = 48, Padding = new Thickness(14, 0, 14, 0), CornerRadius = new CornerRadius(14), Background = Ui.Br(Ui.S2), BorderBrush = Ui.Br(Ui.A(Colors.White, 0x14)), BorderThickness = new Thickness(1), Child = g };
            tb.GotFocus += (s, e) => b.BorderBrush = Ui.Br(Ui.Accent); tb.LostFocus += (s, e) => b.BorderBrush = Ui.Br(Ui.A(Colors.White, 0x14));
            return Tuple.Create(b, tb);
        }
        void Confirm(string title, string text, string yes, Action done)
        {
            var sp = new StackPanel();
            sp.Children.Add(DialogTitle(title, false));
            sp.Children.Add(Ui.Wrap(text, 14, Ui.MUTED));
            var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 20, 0, 0) };
            row.Children.Add(Ui.Pill("Отмена", false, CloseDialog));
            var y = Ui.Pill(yes, true, () => { CloseDialog(); done(); }); y.Margin = new Thickness(10, 0, 0, 0); y.Background = Ui.Br(Ui.C(0xE5484D)); ((TextBlock)((StackPanel)y.Child).Children[0]).Foreground = Brushes.White;
            row.Children.Add(y);
            sp.Children.Add(row);
            OpenDialog(sp, 440);
        }
        Border Pick(string art, string icon, Color iconColor, string title, string sub, bool check, Action a)
        {
            var g = new Grid();
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); g.ColumnDefinitions.Add(new ColumnDefinition()); g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            Border pc;
            if (!string.IsNullOrEmpty(art) && art.StartsWith("http")) pc = Ui.Cover(art, 46, 46, 10);
            else { pc = new Border { Width = 46, Height = 46, CornerRadius = new CornerRadius(10), Background = Ui.Br(Ui.S3) }; var ic = Ui.Icon(icon, 22, iconColor); ic.HorizontalAlignment = HorizontalAlignment.Center; ic.VerticalAlignment = VerticalAlignment.Center; pc.Child = ic; }
            g.Children.Add(pc);
            var m = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(12, 0, 8, 0) };
            m.Children.Add(Ui.Text(title, 14.5, Ui.TEXT, true)); var s = Ui.Wrap(sub, 12, Ui.MUTED); s.Margin = new Thickness(0, 3, 0, 0); m.Children.Add(s);
            Grid.SetColumn(m, 1); g.Children.Add(m);
            if (check) { var c = Ui.Icon("check", 20, Ui.Accent); c.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(c, 2); g.Children.Add(c); }
            var b = new Border { Child = g, Padding = new Thickness(10, 8, 12, 8), CornerRadius = new CornerRadius(14), Background = Ui.Br(Ui.S2), Margin = new Thickness(0, 0, 0, 8), BorderThickness = new Thickness(2), BorderBrush = Brushes.Transparent };
            return a == null ? b : Ui.Click(b, a, Ui.S3);
        }
        async void AddToPlaylist(Track t)
        {
            var sp = new StackPanel();
            sp.Children.Add(DialogTitle("В плейлист"));
            var hint = Ui.Wrap("«" + t.Title + "» — " + (t.Src == "yt" ? "плейлисты YouPlay и YouTube Music" : t.Src == "sc" ? "плейлисты YouPlay и SoundCloud" : "плейлисты YouPlay"), 13, Ui.MUTED); hint.Margin = new Thickness(0, -6, 0, 14); sp.Children.Add(hint);
            var list = new StackPanel(); var sv = Ui.Scroll(list); sv.MaxHeight = 440; sp.Children.Add(sv);
            OpenDialog(sp, 480);
            Action draw = () =>
            {
                list.Children.Clear();
                list.Children.Add(Pick(null, "plus", Ui.Accent, "Новый плейлист", "Создать и добавить трек", false, () => CreatePlaylist(t)));
                foreach (var p0 in Store.List("playlists"))
                {
                    var p = p0; bool has = PlHas(p, t);
                    list.Children.Add(Pick(FirstArt(J.A(p, "items")), "library", Ui.Accent, J.S(p, "name"), "YouPlay · " + J.A(p, "items").Count + " тр.", has, () => { CloseDialog(); if (has) Toast("Уже есть в «" + J.S(p, "name") + "»"); else { AddTo(p, t); Toast("Добавлено в «" + J.S(p, "name") + "»"); } }));
                }
                if (t.Src == "yt" && plYt != null) foreach (var p0 in J.A(plYt, "items")) { var p = p0; list.Children.Add(Pick(J.S(p, "art"), "yt", Ui.YT, J.S(p, "title"), "YouTube Music", false, async () => { CloseDialog(); Toast("Добавляю в YouTube Music…"); var r = await E.Eng("plAdd", "videoId", t.VideoId, "title", t.Title, "artist", t.Artist, "playlist", J.S(p, "title")); Toast(J.B(r, "ok") ? "✓ Добавлено в «" + J.S(p, "title") + "» (YouTube Music)" : J.Has(r, "login") ? "Войдите в YouTube Music в настройках" : "YouTube Music не принял трек — попробуйте ещё раз"); })); }
                if (t.Src == "sc" && plSc != null) foreach (var p0 in J.A(plSc, "items")) { var p = p0; if (J.Has(p, "mine") && !J.B(p, "mine")) continue; list.Children.Add(Pick(J.S(p, "art"), "cloud", Ui.SC, J.S(p, "title"), "SoundCloud · " + (int)J.D(p, "count") + " тр.", false, async () => { CloseDialog(); Toast("Добавляю в SoundCloud…"); var r = await E.Soundcloud("addto", t.Url + "#name=" + Uri.EscapeDataString(J.S(p, "title"))); Toast(J.B(r, "ok") ? "✓ Добавлено в «" + J.S(p, "title") + "» (SoundCloud)" : "SoundCloud не принял трек — попробуйте ещё раз"); })); }
                if (plTask != null && !plTask.IsCompleted) list.Children.Add(Note("Загружаю плейлисты из аккаунтов…"));
            };
            draw();
            if (t.Src != "local") { await LoadRemote(false); if (dialogLayer.Visibility == Visibility.Visible) draw(); }
        }
        void CreatePlaylist(Track t)
        {
            bool ytIn = J.B(E.Account, "signedIn");
            bool ytOk = ytIn && (t == null || t.Src == "yt"), scOk = scLogin && t != null && t.Src == "sc";
            var sp = new StackPanel();
            sp.Children.Add(DialogTitle("Новый плейлист"));
            var f = Field("", "Название плейлиста"); sp.Children.Add(f.Item1);
            var opts = new List<Border>(); string where = "yp";
            var defs = new[] {
                new[] { "yp", "library", "YouPlay", "Любые треки вместе: YouTube Music, SoundCloud и файлы" },
                new[] { "yt", "yt", "YouTube Music", ytOk ? "Сохранится в вашем аккаунте YouTube Music" : !ytIn ? "Войдите в YouTube Music в настройках" : "Сюда можно только треки YouTube Music" },
                new[] { "sc", "cloud", "SoundCloud", scOk ? "Сохранится в вашем аккаунте SoundCloud" : !scLogin ? "Подключите SoundCloud в настройках" : t == null ? "SoundCloud создаёт плейлист вместе с первым треком — нажмите ⋯ у трека SoundCloud" : "Сюда можно только треки SoundCloud" } };
            var lbl = Ui.Text("ГДЕ СОЗДАТЬ", 11.5, Ui.MUTED, true); lbl.Margin = new Thickness(2, 16, 0, 8); sp.Children.Add(lbl);
            foreach (var d0 in defs)
            {
                var d = d0; bool enabled = d[0] == "yp" || (d[0] == "yt" && ytOk) || (d[0] == "sc" && scOk);
                Border b = null;
                b = Pick(null, d[1], d[0] == "yt" ? Ui.YT : d[0] == "sc" ? Ui.SC : Ui.Accent, d[2], d[3], false, () => { if (!enabled) return; where = d[0]; foreach (var o in opts) o.BorderBrush = o == b ? Ui.Br(Ui.Accent) : Brushes.Transparent; });
                b.Opacity = enabled ? 1 : 0.45; if (d[0] == "yp") b.BorderBrush = Ui.Br(Ui.Accent);
                opts.Add(b); sp.Children.Add(b);
            }
            Action make = async () =>
            {
                var name = f.Item2.Text.Trim(); if (name.Length == 0) { f.Item2.Focus(); return; }
                CloseDialog();
                if (where == "yp")
                {
                    var p = J.Make("id", "p" + DateTime.Now.Ticks.ToString("x"), "name", name, "items", t != null ? new object[] { t.Json() } : new object[0]);
                    var all = Store.List("playlists"); all.Insert(0, p); Store.SetList("playlists", all); roots.Remove("lib");
                    Toast("Плейлист «" + name + "» создан");
                    if (tab == "lib" && stack.Count == 1) ShowTab("lib"); else if (t == null) OpenPlaylist(J.S(p, "id"));
                }
                else if (where == "yt")
                {
                    Toast("Создаю плейлист в YouTube Music…");
                    var r = t != null ? await E.Eng("plCreate", "name", name, "videoId", t.VideoId, "title", t.Title, "artist", t.Artist) : await E.Eng("plCreate", "name", name);
                    Toast(J.B(r, "ok") ? "✓ «" + name + "» создан в YouTube Music" : "YouTube Music не создал плейлист — попробуйте ещё раз");
                    plAt = DateTime.MinValue; await LoadRemote(true);
                }
                else
                {
                    Toast("Создаю плейлист в SoundCloud…");
                    var r = await E.Soundcloud("create", t.Url + "#name=" + Uri.EscapeDataString(name));
                    Toast(J.B(r, "ok") ? "✓ «" + name + "» создан в SoundCloud" : "SoundCloud не создал плейлист — попробуйте ещё раз");
                    plAt = DateTime.MinValue; await LoadRemote(true);
                }
            };
            f.Item2.KeyDown += (s, e) => { if (e.Key == Key.Enter) make(); };
            var foot = new Grid { Margin = new Thickness(0, 12, 0, 0) };
            if (t != null) { var n = Ui.Text("«" + t.Title + "» сразу попадёт в плейлист", 12.5, Ui.MUTED); n.VerticalAlignment = VerticalAlignment.Center; n.Margin = new Thickness(0, 0, 130, 0); foot.Children.Add(n); }
            var go = Ui.Pill("Создать", true, () => make()); go.HorizontalAlignment = HorizontalAlignment.Right; foot.Children.Add(go);
            sp.Children.Add(foot);
            OpenDialog(sp, 500);
            Dispatcher.BeginInvoke((Action)(() => f.Item2.Focus()), DispatcherPriority.Input);
        }

        // ═════════ equalizer ═════════
        static readonly string[] EqBands = { "32", "64", "125", "250", "500", "1K", "2K", "4K", "8K", "16K" };
        static readonly Dictionary<string, double[]> EqBuiltIn = new Dictionary<string, double[]> {
            { "Ровно", new double[] { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 } },
            { "Бас", new double[] { 5, 4.5, 3.5, 2, 0.5, 0, 0, 0, 0, 0 } },
            { "Сильный бас", new double[] { 8, 7, 5.5, 3, 1, -0.5, -1, -1, -0.5, 0 } },
            { "Вокал", new double[] { -2, -1.5, -0.5, 1, 3, 3.5, 3, 1.5, 0.5, -0.5 } },
            { "Рок", new double[] { 4.5, 3.5, 2, 0.5, -1, -0.5, 1, 2.5, 3.5, 4 } },
            { "Электроника", new double[] { 5, 4, 1.5, 0, -1.5, 1, 0.5, 1.5, 4, 5 } },
            { "Хип-хоп", new double[] { 5.5, 4.5, 2, 3, -0.5, -0.5, 1, 0, 2, 3 } },
            { "Акустика", new double[] { 3, 3, 2.5, 1, 1.5, 1.5, 2.5, 3, 2.5, 1.5 } },
            { "Поп", new double[] { -1, -0.5, 0, 2, 3.5, 3.5, 2, 0, -0.5, -1 } },
            { "Ночью тихо", new double[] { 2, 1.5, 1, 0, -1, -1.5, -1, 0, 1, 1.5 } },
            { "Высокие", new double[] { -1, -1, -0.5, 0, 0.5, 1.5, 3, 4.5, 5.5, 6 } },
        };
        double[] EqGains()
        {
            var a = J.Strs(Store.Data, "eqGains"); var g = new double[10];
            for (int i = 0; i < 10 && i < a.Count; i++) double.TryParse(a[i], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out g[i]);
            return g;
        }
        Dictionary<string, object> EqCustom() { return Store.Obj("eqPresets") ?? new Dictionary<string, object>(); }
        void SaveGains(double[] g) { Store.Set("eqGains", g.Select(x => (object)Math.Round(x, 1)).ToArray()); }
        void ApplyEq() { E.Equalizer(Store.Bool("eqOn", false), EqGains()); }
        void OpenEqualizer()
        {
            var sp = new StackPanel();
            var head = new Grid { Margin = new Thickness(0, 0, 0, 6) };
            var t = Ui.Text("Эквалайзер", 22, Ui.TEXT, true, true); t.FontWeight = FontWeights.Bold; t.VerticalAlignment = VerticalAlignment.Center; head.Children.Add(t);
            var right = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            bool on = Store.Bool("eqOn", false);
            var knob = new Border { Width = 22, Height = 22, CornerRadius = new CornerRadius(11), Background = Brushes.White, HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(3, 0, 0, 0), RenderTransform = new TranslateTransform(on ? 20 : 0, 0) };
            var trackBg = new SolidColorBrush(on ? Ui.Accent : Ui.S3);
            var sw = new Border { Width = 48, Height = 28, CornerRadius = new CornerRadius(14), Background = trackBg, Child = knob, VerticalAlignment = VerticalAlignment.Center, Cursor = Cursors.Hand, Margin = new Thickness(0, 0, 10, 0) };
            right.Children.Add(sw);
            right.Children.Add(Ui.IconButton("close", 34, 18, Ui.MUTED, Colors.Transparent, CloseDialog, "Закрыть"));
            head.Children.Add(right);
            sp.Children.Add(head);
            var note = Ui.Wrap("Работает для YouTube Music и ваших файлов. Плеер SoundCloud закрыт — его звук не обработать.", 12.5, Ui.MUTED); note.Margin = new Thickness(0, 0, 0, 14); sp.Children.Add(note);
            var presets = new WrapPanel { Margin = new Thickness(0, 0, 0, 12) }; sp.Children.Add(presets);
            var sliders = new Grid { Height = 230, Margin = new Thickness(0, 4, 0, 0) };
            for (int i = 0; i < 10; i++) sliders.ColumnDefinitions.Add(new ColumnDefinition());
            var g = EqGains(); var sl = new Slider[10]; var vals = new TextBlock[10];
            bool painting = false;
            Action<string> paintPresets = null;
            Action changed = () => { if (painting) return; for (int i = 0; i < 10; i++) g[i] = Math.Round(sl[i].Value * 2) / 2; SaveGains(g); Store.Set("eqPreset", "Свой"); ApplyEq(); for (int i = 0; i < 10; i++) vals[i].Text = (g[i] > 0 ? "+" : "") + g[i].ToString("0.#"); paintPresets("Свой"); };
            for (int i = 0; i < 10; i++)
            {
                var col = new Grid(); col.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); col.RowDefinitions.Add(new RowDefinition()); col.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                vals[i] = Ui.Text((g[i] > 0 ? "+" : "") + g[i].ToString("0.#"), 11.5, Ui.TEXT, true); vals[i].HorizontalAlignment = HorizontalAlignment.Center; col.Children.Add(vals[i]);
                sl[i] = new Slider { Orientation = Orientation.Vertical, Minimum = -12, Maximum = 12, Value = g[i], HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 6, 0, 6), IsMoveToPointEnabled = true, SmallChange = 0.5, LargeChange = 1, Foreground = Ui.Br(Ui.Accent) };
                sl[i].ValueChanged += (s, e) => changed();
                Grid.SetRow(sl[i], 1); col.Children.Add(sl[i]);
                var lb = Ui.Text(EqBands[i], 11.5, Ui.MUTED); lb.HorizontalAlignment = HorizontalAlignment.Center; Grid.SetRow(lb, 2); col.Children.Add(lb);
                Grid.SetColumn(col, i); sliders.Children.Add(col);
            }
            sp.Children.Add(sliders);
            Action<double[], string> setAll = (vals2, name) => { painting = true; for (int i = 0; i < 10; i++) { sl[i].Value = vals2[i]; g[i] = vals2[i]; vals[i].Text = (g[i] > 0 ? "+" : "") + g[i].ToString("0.#"); } painting = false; SaveGains(g); Store.Set("eqPreset", name); if (!Store.Bool("eqOn", false) && name != "Ровно") { Store.Set("eqOn", true); on = true; ((TranslateTransform)knob.RenderTransform).X = 20; trackBg.Color = Ui.Accent; } ApplyEq(); paintPresets(name); };
            paintPresets = sel =>
            {
                presets.Children.Clear();
                foreach (var kv in EqBuiltIn) { var k = kv; presets.Children.Add(Ui.Chip(k.Key, sel == k.Key, () => setAll(k.Value, k.Key))); }
                foreach (var kv in EqCustom())
                {
                    var name = kv.Key; var arr = J.Strs(EqCustom(), name).Select(x => { double d; double.TryParse(x, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out d); return d; }).ToArray();
                    if (arr.Length != 10) continue;
                    var chip = Ui.Chip("★ " + name, sel == name, () => setAll(arr, name));
                    chip.MouseRightButtonUp += (s, e) => Confirm("Удалить пресет «" + name + "»?", "Он пропадёт из списка пресетов.", "Удалить", () => { var c = EqCustom(); c.Remove(name); Store.Set("eqPresets", c); OpenEqualizer(); });
                    presets.Children.Add(chip);
                }
                presets.Children.Add(Ui.Chip("+ Сохранить как…", false, () => AskText("Название пресета", "", n => { var c = EqCustom(); c[n] = g.Select(x => (object)x).ToArray(); Store.Set("eqPresets", c); Store.Set("eqPreset", n); Toast("Пресет «" + n + "» сохранён"); OpenEqualizer(); })));
            };
            paintPresets(Store.Get("eqPreset", "Ровно"));
            sw.MouseLeftButtonUp += (s, e) =>
            {
                on = !on; Store.Set("eqOn", on); ApplyEq();
                ((TranslateTransform)knob.RenderTransform).BeginAnimation(TranslateTransform.XProperty, new DoubleAnimation(on ? 20 : 0, TimeSpan.FromMilliseconds(180)));
                trackBg.BeginAnimation(SolidColorBrush.ColorProperty, new ColorAnimation(on ? Ui.Accent : Ui.S3, TimeSpan.FromMilliseconds(180)));
                Toast(on ? "Эквалайзер включён" : "Эквалайзер выключен");
            };
            var foot = new Grid { Margin = new Thickness(0, 10, 0, 0) };
            var hintT = Ui.Text("Правый клик по ★ пресету — удалить", 11.5, Ui.FAINT); hintT.VerticalAlignment = VerticalAlignment.Center; foot.Children.Add(hintT);
            var reset = Ui.Pill("Сбросить", false, () => setAll(EqBuiltIn["Ровно"], "Ровно")); reset.HorizontalAlignment = HorizontalAlignment.Right; foot.Children.Add(reset);
            sp.Children.Add(foot);
            OpenDialog(sp, 640);
        }

        // ═════════ toast ═════════
        void Toast(string s)
        {
            var b = new Border { Padding = new Thickness(18, 12, 18, 12), CornerRadius = new CornerRadius(14), Background = Ui.Br(Ui.C(0x322A26)), BorderBrush = Ui.Br(Ui.A(Colors.White, 0x18)), BorderThickness = new Thickness(1), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 0, bar.Visibility == Visibility.Visible && !npOpen ? 110 : 34), Child = Ui.Text(s, 14, Ui.TEXT, true), Effect = new DropShadowEffect { BlurRadius = 30, ShadowDepth = 8, Opacity = 0.45 } };
            toastLayer.Children.Clear(); toastLayer.Children.Add(b);
            var tt = new TranslateTransform(0, 14); b.RenderTransform = tt; b.Opacity = 0;
            Ui.Fade(b, 1, 180); tt.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(0, TimeSpan.FromMilliseconds(240)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(2600) };
            timer.Tick += (x, y) => { timer.Stop(); Ui.Fade(b, 0, 220, () => toastLayer.Children.Remove(b)); };
            timer.Start();
        }

        // ═════════ updates ═════════
        TextBlock updLine; bool updAsked; TextBlock updProgress; Border updBar;
        string UpdText()
        {
            switch (Updater.State)
            {
                case "checking": return "Проверяю обновления…";
                case "none": return "У вас последняя версия ✓";
                case "available": return "Вышла версия " + Updater.LatestTag;
                case "downloading": return "Скачиваю… " + Updater.Percent + "%";
                case "installing": return "Устанавливаю — YouPlay сейчас перезапустится";
                case "error": return "Не удалось проверить обновления";
                case "dev": return "Тестовая копия — обновления выключены";
                default: return "Обновления проверяются при запуске";
            }
        }
        void OnUpdateState()
        {
            if (updLine != null) updLine.Text = UpdText();
            if (updProgress != null) { updProgress.Text = UpdText(); if (updBar != null) updBar.Width = 380 * (Updater.State == "installing" ? 1 : Updater.Percent / 100.0); }
            if (Updater.State == "available" && !updAsked)
            {
                updAsked = true;
                var sp = new StackPanel();
                var ic = Ui.Icon("update", 36, Ui.Accent); ic.HorizontalAlignment = HorizontalAlignment.Left; sp.Children.Add(ic);
                var h = Ui.Text("Вышло обновление YouPlay", 22, Ui.TEXT, true, true); h.FontWeight = FontWeights.Bold; h.Margin = new Thickness(0, 12, 0, 6); sp.Children.Add(h);
                updProgress = Ui.Wrap("Версия " + Updater.LatestTag + " (у вас " + Program.Version + "). Вход, плейлисты и настройки сохранятся.", 14, Ui.MUTED); sp.Children.Add(updProgress);
                var track = new Border { Height = 6, CornerRadius = new CornerRadius(3), Background = Ui.Br(Ui.S3), Margin = new Thickness(0, 16, 0, 0) };
                updBar = new Border { Height = 6, Width = 0, CornerRadius = new CornerRadius(3), Background = Ui.Br(Ui.Accent), HorizontalAlignment = HorizontalAlignment.Left };
                track.Child = updBar; sp.Children.Add(track);
                var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 18, 0, 0) };
                row.Children.Add(Ui.Pill("Позже", false, () => { updProgress = null; CloseDialog(); }));
                var go = Ui.Pill("Обновить сейчас", true, UpdateNow); go.Margin = new Thickness(10, 0, 0, 0); row.Children.Add(go);
                sp.Children.Add(row);
                OpenDialog(sp, 440);
            }
        }
        void UpdateNow()
        {
            if (Updater.State != "available" || Updater.LatestUrl == null) return;
            Updater.State = "downloading"; Updater.Percent = 0; OnUpdateState();
            string dir = System.IO.Path.Combine(Program.Data, "Updates"); Directory.CreateDirectory(dir);
            string file = System.IO.Path.Combine(dir, "YouPlay-Setup-" + Updater.LatestTag + ".exe");
            var wc = new WebClient(); wc.Headers.Add("User-Agent", "YouPlay");
            wc.DownloadProgressChanged += (s, e) => { if (e.ProgressPercentage != Updater.Percent) { Updater.Percent = e.ProgressPercentage; Dispatcher.BeginInvoke((Action)OnUpdateState); } };
            wc.DownloadFileCompleted += (s, e) => Dispatcher.BeginInvoke((Action)(() =>
            {
                wc.Dispose();
                if (e.Error != null || e.Cancelled) { Updater.State = "error"; OnUpdateState(); return; }
                try
                {
                    if (File.Exists(file)) File.Delete(file);
                    File.Move(file + ".part", file);
                    Updater.State = "installing"; OnUpdateState();
                    Store.SaveNow();
                    Process.Start(new ProcessStartInfo(file, "/S") { UseShellExecute = false });
                    var t = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(900) }; t.Tick += (a, b) => { t.Stop(); Close(); }; t.Start();
                }
                catch { Updater.State = "error"; OnUpdateState(); }
            }));
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;
            wc.DownloadFileAsync(new Uri(Updater.LatestUrl), file + ".part");
        }
    }
}
