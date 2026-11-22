using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;

namespace YouPlay
{
    /// <summary>A theme: colours of the whole interface; "glass" themes use the Windows acrylic backdrop.</summary>
    class Theme
    {
        public string Id, Name, Font = "Segoe UI Variable Text, Segoe UI", Display = "Segoe UI Variable Display, Segoe UI"; public Color Bg, Surf, S2, S3, Text, Muted, Faint, Accent; public bool Glass, Square, AccentFill; public double Round = 1; public Color OnAccent = Ui.C(0x111111);
        public static readonly List<Theme> All = new List<Theme> {
            new Theme { Id = "studio", Name = "Studio", Bg = Ui.C(0x120D0B), Surf = Ui.C(0x1C1512), S2 = Ui.C(0x2A221E), S3 = Ui.C(0x3A302B), Text = Ui.C(0xF4EEEA), Muted = Ui.C(0xA79B94), Faint = Ui.C(0x6E625C), Accent = Ui.C(0xFF5A36) },
            new Theme { Id = "midnight", Name = "Midnight", Bg = Ui.C(0x0B0D14), Surf = Ui.C(0x141824), S2 = Ui.C(0x1E2333), S3 = Ui.C(0x2B3146), Text = Ui.C(0xEEF1F8), Muted = Ui.C(0x9AA1B5), Faint = Ui.C(0x5E6478), Accent = Ui.C(0x4A7DFF) },
            new Theme { Id = "glass", Name = "Liquid Glass", Glass = true, Round = 1.1, Bg = Color.FromArgb(0xC4, 0x12, 0x10, 0x1C), Surf = Color.FromArgb(0xB0, 0x1E, 0x1B, 0x2C), S2 = Color.FromArgb(0x20, 0xFF, 0xFF, 0xFF), S3 = Color.FromArgb(0x36, 0xFF, 0xFF, 0xFF), Text = Ui.C(0xFFFFFF), Muted = Color.FromArgb(0xC8, 0xFF, 0xFF, 0xFF), Faint = Color.FromArgb(0x88, 0xFF, 0xFF, 0xFF), Accent = Ui.C(0xFF3D77) },
            new Theme { Id = "material", Name = "Material", Round = 1.2, AccentFill = true, OnAccent = Ui.C(0x381E72), Font = "Google Sans Text, Google Sans, Roboto, Segoe UI", Display = "Google Sans Display, Google Sans, Roboto, Segoe UI", Bg = Ui.C(0x141218), Surf = Ui.C(0x211F26), S2 = Ui.C(0x2B2930), S3 = Ui.C(0x3B383E), Text = Ui.C(0xE6E1E5), Muted = Ui.C(0xCAC4D0), Faint = Ui.C(0x938F99), Accent = Ui.C(0xD0BCFF) },
            new Theme { Id = "holo", Name = "Android Holo", Square = true, AccentFill = true, OnAccent = Ui.C(0x000000), Font = "Roboto, Segoe UI", Display = "Roboto Light, Roboto, Segoe UI Light", Bg = Ui.C(0x000000), Surf = Ui.C(0x101010), S2 = Ui.C(0x1C1C1C), S3 = Ui.C(0x2C2C2C), Text = Ui.C(0xFFFFFF), Muted = Ui.C(0xA0A0A0), Faint = Ui.C(0x5C5C5C), Accent = Ui.C(0x33B5E5) },
            new Theme { Id = "aero", Name = "Windows 7 Aero", Glass = true, Round = 0.45, AccentFill = true, OnAccent = Ui.C(0x0B2A4A), Font = "Segoe UI", Display = "Segoe UI", Bg = Color.FromArgb(0xC8, 0x10, 0x48, 0x86), Surf = Color.FromArgb(0xB8, 0x17, 0x58, 0x9C), S2 = Color.FromArgb(0x2A, 0xFF, 0xFF, 0xFF), S3 = Color.FromArgb(0x44, 0xFF, 0xFF, 0xFF), Text = Ui.C(0xFFFFFF), Muted = Ui.C(0xDCEBFA), Faint = Color.FromArgb(0xB0, 0xDC, 0xEB, 0xFA), Accent = Ui.C(0x9ED3FF) },
        };
        public static Theme Get(string id) { foreach (var t in All) if (t.Id == id) return t; return All[0]; }
        public void Apply()
        {
            Ui.BG = Bg; Ui.SURF = Surf; Ui.S2 = S2; Ui.S3 = S3; Ui.TEXT = Text; Ui.MUTED = Muted; Ui.FAINT = Faint;
            Ui.Round = Round; Ui.Square = Square;
            Ui.Font = new FontFamily(Font); Ui.Display = new FontFamily(Display);
        }
    }

    partial class MainWindow
    {
        [StructLayout(LayoutKind.Sequential)] struct MARGINS { public int L, R, T, B; }
        [DllImport("dwmapi.dll")] static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref MARGINS m);
        Theme theme;

        void LoadTheme()
        {
            theme = Theme.Get(Store.Get("theme", "studio"));
            theme.Apply();
            var acc = Store.Get("accent", "");
            Ui.Accent = acc.Length > 0 ? Ui.C((int)Store.Num("accent", 0)) : theme.Accent;
            // filled buttons: the accent colour in Material / Holo / Aero, light in the others
            Ui.Fill = theme.AccentFill ? Ui.Accent : (theme.Glass ? Colors.White : Ui.TEXT);
            Ui.OnFill = theme.AccentFill ? (acc.Length > 0 ? Ui.C(0x111111) : theme.OnAccent) : Ui.C(0x111111);
            Ui.NavOn = theme.Square ? Ui.A(Ui.Accent, 0x26) : theme.AccentFill ? Ui.A(Ui.Accent, 0x30) : Ui.S2;
        }
        /// <summary>Glass themes: transparent window over the Windows acrylic backdrop; others: solid window.</summary>
        void ApplyBackdrop()
        {
            try
            {
                var h = new WindowInteropHelper(this).Handle; if (h == IntPtr.Zero) return;
                var src = HwndSource.FromHwnd(h);
                int type = theme.Glass ? 3 : 1;   // DWMWA_SYSTEMBACKDROP_TYPE: 3 = acrylic, 1 = none
                var m = theme.Glass ? new MARGINS { L = -1, R = -1, T = -1, B = -1 } : new MARGINS();
                if (src != null && src.CompositionTarget != null) src.CompositionTarget.BackgroundColor = theme.Glass ? Colors.Transparent : Ui.BG;
                DwmExtendFrameIntoClientArea(h, ref m);
                DwmSetWindowAttribute(h, 38, ref type, 4);
                int dark = 1; DwmSetWindowAttribute(h, 20, ref dark, 4);
                if (!theme.Glass) { int bgr = (Ui.BG.B << 16) | (Ui.BG.G << 8) | Ui.BG.R; DwmSetWindowAttribute(h, 35, ref bgr, 4); DwmSetWindowAttribute(h, 34, ref bgr, 4); }
                else { int def = unchecked((int)0xFFFFFFFF); DwmSetWindowAttribute(h, 35, ref def, 4); DwmSetWindowAttribute(h, 34, ref def, 4); }
            }
            catch { }
            Background = theme.Glass ? (Brush)Brushes.Transparent : Ui.Br(Ui.BG);
        }
        void SetTheme(string id)
        {
            Store.Set("theme", id); Store.Set("accent", "");
            LoadTheme(); RebuildAll();
            Toast("Тема «" + theme.Name + "»");
        }
        void RebuildAll()
        {
            FontFamily = Ui.Font;
            ApplyBackdrop();
            roots.Clear(); stack.Clear();
            clipView = null; clipFor = null;
            var keepTab = tab == "search" ? "home" : tab;
            BuildShell();
            ShowTab(keepTab);
            if (P.Cur != null) { lastArt = ""; lastKey = ""; OnTrack(); }
        }
        FrameworkElement ThemePicker()
        {
            var wrap = new WrapPanel();
            foreach (var t0 in Theme.All)
            {
                var t = t0; bool on = theme != null && theme.Id == t.Id;
                var pv = new Grid { Width = 132, Height = 78 };
                pv.Children.Add(new Border { CornerRadius = new CornerRadius(12), Background = t.Glass ? (Brush)new LinearGradientBrush(Color.FromRgb(0x6A, 0x3D, 0xD9), Color.FromRgb(0x22, 0xD3, 0xEE), 30) : Ui.Br(Color.FromRgb(t.Bg.R, t.Bg.G, t.Bg.B)) });
                var inner = new StackPanel { Margin = new Thickness(10) };
                inner.Children.Add(new Border { Height = 10, Width = 70, HorizontalAlignment = HorizontalAlignment.Left, CornerRadius = new CornerRadius(5), Background = Ui.Br(t.Accent) });
                inner.Children.Add(new Border { Height = 8, Width = 100, Margin = new Thickness(0, 8, 0, 0), HorizontalAlignment = HorizontalAlignment.Left, CornerRadius = new CornerRadius(4), Background = Ui.Br(t.S3) });
                inner.Children.Add(new Border { Height = 8, Width = 60, Margin = new Thickness(0, 6, 0, 0), HorizontalAlignment = HorizontalAlignment.Left, CornerRadius = new CornerRadius(4), Background = Ui.Br(t.S2) });
                pv.Children.Add(inner);
                var c = new StackPanel(); c.Children.Add(pv);
                var n = Ui.Text(t.Name, 13, on ? Ui.TEXT : Ui.MUTED, true); n.Margin = new Thickness(2, 8, 0, 0); c.Children.Add(n);
                var card = new Border { Child = c, Padding = new Thickness(8), CornerRadius = new CornerRadius(16), Margin = new Thickness(0, 0, 10, 10), Background = Ui.Br(on ? Ui.S2 : Colors.Transparent), BorderBrush = Ui.Br(on ? Ui.Accent : Colors.Transparent), BorderThickness = new Thickness(2) };
                wrap.Children.Add(Ui.Click(card, () => SetTheme(t.Id), Ui.S2));
            }
            return wrap;
        }
    }
}
