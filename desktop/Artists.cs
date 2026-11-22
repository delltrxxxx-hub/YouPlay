using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace YouPlay
{
    partial class MainWindow
    {
        // ═════════ my artists (sidebar) ═════════
        StackPanel sideArtists; bool artistsSynced;
        List<Dictionary<string, object>> MyArtists() { return Store.List("artists"); }
        static string ArtistKey(string href) { var m = Regex.Match(href ?? "", @"(UC[\w-]+)"); return m.Success ? m.Groups[1].Value : href ?? ""; }
        bool Following(string href) { var k = ArtistKey(href); return MyArtists().Any(a => ArtistKey(J.S(a, "href")) == k); }
        void PaintSideArtists()
        {
            if (sideArtists == null) return;
            sideArtists.Children.Clear();
            var list = MyArtists();
            var head = Ui.Text("МОИ ИСПОЛНИТЕЛИ", 11, Ui.FAINT, true); head.Margin = new Thickness(14, 18, 0, 8); sideArtists.Children.Add(head);
            if (list.Count == 0) { var n = Ui.Wrap("Подпишитесь на исполнителя — он появится здесь", 12, Ui.FAINT); n.Margin = new Thickness(14, 0, 8, 0); sideArtists.Children.Add(n); return; }
            foreach (var a0 in list)
            {
                var a = a0;
                var sp = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
                sp.Children.Add(Ui.Cover(J.S(a, "art"), 30, 30, 15, "user"));
                var t = Ui.Text(J.S(a, "name"), 13.5, Ui.MUTED, true); t.Margin = new Thickness(11, 0, 0, 0); t.VerticalAlignment = VerticalAlignment.Center; t.MaxWidth = 150; sp.Children.Add(t);
                var b = new Border { Height = 42, Padding = new Thickness(10, 0, 10, 0), CornerRadius = Ui.CR(12), Background = Ui.Br(Colors.Transparent), Child = sp };
                b.ToolTip = "Правый клик — отписаться";
                b.MouseRightButtonUp += (s, e) => { Confirm("Отписаться от " + J.S(a, "name") + "?", "Исполнитель пропадёт из «Мои исполнители»" + (J.B(E.Account, "signedIn") ? " и из подписок YouTube Music." : "."), "Отписаться", () => Follow(J.S(a, "href"), J.S(a, "name"), J.S(a, "art"), false, () => PaintFollow())); e.Handled = true; };
                sideArtists.Children.Add(Ui.Click(b, () => OpenArtist(J.S(a, "href"), J.S(a, "name"), J.S(a, "art")), Ui.A(Colors.White, 0x0C)));
            }
        }
        async void SyncArtists()
        {
            if (artistsSynced || !J.B(E.Account, "signedIn")) return;
            artistsSynced = true;
            var r = await E.Eng("artists");
            var list = MyArtists(); bool changed = false;
            foreach (var a in J.A(r, "items")) if (!list.Any(x => ArtistKey(J.S(x, "href")) == ArtistKey(J.S(a, "href")))) { list.Add(a); changed = true; }
            if (changed) { Store.SetList("artists", list); PaintSideArtists(); }
        }
        async void Follow(string href, string name, string art, bool on, Action done)
        {
            var list = MyArtists().Where(a => ArtistKey(J.S(a, "href")) != ArtistKey(href)).ToList();
            if (on) list.Insert(0, J.Make("href", href, "name", name, "art", art));
            Store.SetList("artists", list); PaintSideArtists();
            Toast(on ? "Вы подписаны на " + name : "Вы отписались от " + name);
            if (done != null) done();
            if (J.B(E.Account, "signedIn")) { var r = await E.Eng("subscribe", "href", href, "on", on); if (!J.B(r, "ok")) Toast("YouTube Music не принял подписку — она сохранена в YouPlay"); }
        }

        // ═════════ follow from the player ═════════
        string npArtistHref;
        void PaintFollow()
        {
            if (npFollowHost == null) return;
            var t = P.Cur;
            if (t == null || t.Src != "yt") { npFollowHost.Child = null; return; }
            npArtistHref = t.ArtistHref;
            bool f = npArtistHref != null && Following(npArtistHref);
            var b = new Border { Height = 30, Padding = new Thickness(12, 0, 14, 0), CornerRadius = Ui.CR(15), Background = Ui.Br(f ? Ui.A(Colors.White, 0x1C) : Ui.Fill), ToolTip = f ? "Нажмите, чтобы отписаться" : "Подписаться на исполнителя" };
            var sp = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            var ic = Ui.Icon(f ? "check" : "plus", 15, f ? Ui.TEXT : Ui.OnFill); ic.Margin = new Thickness(0, 0, 6, 0); sp.Children.Add(ic);
            sp.Children.Add(Ui.Text(f ? "Вы подписаны" : "Подписаться", 12.5, f ? Ui.TEXT : Ui.OnFill, true));
            b.Child = sp;
            npFollowHost.Child = Ui.Click(b, FollowCurrent, f ? Ui.A(Colors.White, 0x2A) : Ui.Lighten(Ui.Fill, 0.15));
        }
        async void FollowCurrent()
        {
            var t = P.Cur; if (t == null) return;
            var hit = await ResolveArtist(t);
            if (hit == null) { Toast("Не нашёл страницу исполнителя"); return; }
            if (t.ArtistHref == null) t.ArtistHref = hit.Browse;
            Follow(hit.Browse, hit.Title, hit.Art, !Following(hit.Browse), PaintFollow);
        }
        /// <summary>The artist's page of a track: from the track itself, or found by name.</summary>
        async Task<Track> ResolveArtist(Track t)
        {
            var name = Regex.Split(t.Artist ?? "", @",| и | & | feat\.| ft\.| x ", RegexOptions.IgnoreCase)[0].Trim();
            if (!string.IsNullOrEmpty(t.ArtistHref)) { var known = MyArtists().FirstOrDefault(a => ArtistKey(J.S(a, "href")) == ArtistKey(t.ArtistHref)); return new Track { Browse = t.ArtistHref, Title = known != null ? J.S(known, "name") : name, Art = known != null ? J.S(known, "art") : null }; }
            if (t.Src != "yt" || name.Length == 0) return null;
            var r = await E.Eng("search", "q", name);
            var more = Track.List(J.A(r, "more"), "yt");
            return more.FirstOrDefault(x => x.Browse != null && Regex.IsMatch(x.Browse, @"channel/|browse/UC") && (x.Kind == "artist" || x.Round || string.Equals(x.Title, name, StringComparison.CurrentCultureIgnoreCase)))
                ?? more.FirstOrDefault(x => x.Browse != null && Regex.IsMatch(x.Browse, @"channel/|browse/UC"));
        }

        // ═════════ artist page ═════════
        async void OpenArtistFor(Track t)
        {
            if (t == null) return;
            if (!string.IsNullOrEmpty(t.ArtistHref)) { OpenArtist(t.ArtistHref, t.Artist.Split(new[] { ",", " и ", " & ", " feat" }, StringSplitOptions.None)[0].Trim(), null); return; }
            if (t.Src != "yt") { Toast("Страницы исполнителей есть для треков YouTube Music"); return; }
            var name = Regex.Split(t.Artist, @",| и | & | feat\.| ft\.| x ", RegexOptions.IgnoreCase)[0].Trim();
            if (name.Length == 0) return;
            Toast("Ищу исполнителя «" + name + "»…");
            var r = await E.Eng("search", "q", name);
            var hit = Track.List(J.A(r, "more"), "yt").FirstOrDefault(x => x.Browse != null && Regex.IsMatch(x.Browse, @"channel/|browse/UC") && (x.Kind == "artist" || x.Round || string.Equals(x.Title, name, StringComparison.CurrentCultureIgnoreCase)))
                   ?? Track.List(J.A(r, "more"), "yt").FirstOrDefault(x => x.Browse != null && Regex.IsMatch(x.Browse, @"channel/|browse/UC"));
            if (hit == null) { Toast("Не нашёл страницу исполнителя"); return; }
            OpenArtist(hit.Browse, hit.Title, hit.Art);
        }
        async void OpenArtist(string href, string name, string art)
        {
            var host = new Grid(); Push("artist", host);
            var b0 = PageBody(); b0.Children.Add(ArtistHero(art, name ?? "", "Загружаю…", null)); host.Children.Add(Ui.Scroll(b0));
            var d = await Cached("browse:" + href, () => E.Eng("browse", "href", href));
            var title = J.S(d, "title"); if (title.Length == 0) title = name ?? "";
            var img = J.S(d, "art"); if (img.Length == 0) img = art;
            var tracks = Track.List(J.A(d, "tracks"), "yt").Where(t => !IsDisliked(t)).ToList();
            foreach (var t in tracks) if (t.ArtistHref == null) t.ArtistHref = href;
            var body = PageBody(); var sv = Ui.Scroll(body);
            Border followBtn = null;
            Action paintFollow = null;
            paintFollow = () =>
            {
                bool f = Following(href);
                var nb = Ui.Pill(f ? "Вы подписаны" : "Подписаться", !f, () => Follow(href, title, img, !Following(href), () => { paintFollow(); PaintFollow(); }), f ? "check" : "plus");
                nb.ToolTip = f ? "Нажмите, чтобы отписаться" : "Подписаться на исполнителя";
                if (followBtn != null && followBtn.Parent is Panel) { var p = (Panel)followBtn.Parent; int i = p.Children.IndexOf(followBtn); p.Children.RemoveAt(i); nb.Margin = followBtn.Margin; p.Children.Insert(i, nb); }
                followBtn = nb;
            };
            paintFollow();
            body.Children.Add(ArtistHero(img, title, J.S(d, "subtitle"), new FrameworkElement[] { Ui.Pill("Слушать", true, () => PlayList(tracks, 0, title), "play"), Ui.Pill("Перемешать", false, () => PlayList(Shuffled(tracks), 0, title), "shuffle"), followBtn }));
            if (tracks.Count > 0) { body.Children.Add(SectionTitle("Популярные треки")); for (int k = 0; k < Math.Min(10, tracks.Count); k++) body.Children.Add(Row(tracks[k], tracks, k, title, null)); }
            foreach (var s in J.A(d, "sections"))
            {
                var items = Track.List(J.A(s, "items"), "yt"); if (items.Count == 0) continue;
                body.Children.Add(SectionTitle(J.S(s, "title").Length > 0 ? J.S(s, "title") : "Ещё"));
                body.Children.Add(Cards(items, J.S(s, "title")));
            }
            if (tracks.Count == 0 && J.A(d, "sections").Count == 0) body.Children.Add(Note("YouTube Music не показал страницу исполнителя — попробуйте ещё раз"));
            host.Children.Clear(); host.Children.Add(sv);
        }
        FrameworkElement ArtistHero(string art, string name, string sub, FrameworkElement[] buttons)
        {
            var g = new Grid { Margin = new Thickness(0, 4, 0, 18) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); g.ColumnDefinitions.Add(new ColumnDefinition());
            var cv = Ui.Cover(art, 200, 200, 100, "user");
            cv.Effect = new System.Windows.Media.Effects.DropShadowEffect { BlurRadius = 40, ShadowDepth = 10, Opacity = 0.45 };
            g.Children.Add(cv);
            var r = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(30, 0, 0, 0) };
            r.Children.Add(Ui.Text("ИСПОЛНИТЕЛЬ", 11.5, Ui.Accent, true));
            var t = Ui.Text(name, 48, Ui.TEXT, true, true); t.FontWeight = FontWeights.Bold; t.Margin = new Thickness(0, 6, 0, 0); r.Children.Add(t);
            if (!string.IsNullOrEmpty(sub)) { var s = Ui.Text(sub, 14, Ui.MUTED); s.Margin = new Thickness(0, 6, 0, 0); r.Children.Add(s); }
            if (buttons != null) { var br = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 18, 0, 0) }; foreach (var b in buttons) { b.Margin = new Thickness(0, 0, 10, 0); br.Children.Add(b); } r.Children.Add(br); }
            Grid.SetColumn(r, 1); g.Children.Add(r);
            return g;
        }

        // ═════════ about the track: the back of the flipped cover ═════════
        async void FillTrackInfo(StackPanel host, Track t, bool compact)
        {
            host.Children.Add(Ui.Text("О ТРЕКЕ", 11.5, Ui.Accent, true));
            var tt = Ui.Wrap(t.Title, compact ? 20 : 22, Ui.TEXT, true); tt.FontFamily = Ui.Display; tt.Margin = new Thickness(0, 6, 0, 2); host.Children.Add(tt);
            var facts = new StackPanel { Margin = new Thickness(0, 10, 0, 0) }; host.Children.Add(facts);
            facts.Children.Add(Ui.Text("Ищу сведения…", 13, Ui.MUTED));
            var info = await Meta.Lookup(t, P.Dur > 0 && P.Cur != null && P.Cur.Key == t.Key ? P.Dur : t.Duration);
            Dictionary<string, object> credits = null;
            if (t.Src == "yt" && P.Cur != null && P.Cur.Key == t.Key) credits = await E.Eng("credits", "videoId", t.VideoId);
            facts.Children.Clear();
            Action<string, string> fact = (k, v) =>
            {
                if (string.IsNullOrEmpty(v)) return;
                var sp = new StackPanel { Margin = new Thickness(0, 0, 0, 9) };
                sp.Children.Add(Ui.Text(k.ToUpperInvariant(), 10.5, Ui.FAINT, true)); var vt = Ui.Wrap(v, 13.5, Ui.TEXT, true); vt.Margin = new Thickness(0, 2, 0, 0); sp.Children.Add(vt);
                facts.Children.Add(sp);
            };
            fact("Исполнители", info.Artists.Count > 0 ? string.Join(", ", info.Artists) : t.Artist);
            fact("Альбом", info.Album);
            fact("Год выпуска", info.Year);
            fact("Длительность", (P.Cur != null && P.Cur.Key == t.Key && P.Dur > 0) ? Ui.Fmt(P.Dur) : t.Duration > 0 ? Ui.Fmt(t.Duration) : t.DurText);
            if (credits != null) foreach (var c in J.A(credits, "items")) fact(J.S(c, "role"), J.S(c, "names"));
            foreach (var kv in info.Credits) fact(kv.Key, kv.Value);
            if (info.Bio.Length > 0)
            {
                var h = Ui.Text("ОБ ИСПОЛНИТЕЛЕ · " + info.BioName.ToUpperInvariant(), 10.5, Ui.FAINT, true); h.Margin = new Thickness(0, 6, 0, 4); facts.Children.Add(h);
                facts.Children.Add(Ui.Wrap(info.Bio, 13, Ui.MUTED));
                var src = Ui.Text("Википедия · MusicBrainz", 11, Ui.FAINT); src.Margin = new Thickness(0, 6, 0, 0); facts.Children.Add(src);
            }
            var go = Ui.Pill("Страница исполнителя", true, () => { CloseDialog(); CloseNP(); OpenArtistFor(t); }, "user");
            go.HorizontalAlignment = HorizontalAlignment.Left; go.Margin = new Thickness(0, 12, 0, 0); facts.Children.Add(go);
        }

        // ═════════ about the track (dialog from the ⋯ menu) ═════════
        async void TrackInfo(Track t)
        {
            if (t == null) return;
            var sp = new StackPanel();
            var top = new Grid(); top.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); top.ColumnDefinitions.Add(new ColumnDefinition()); top.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            top.Children.Add(Ui.Cover(t.Art, 120, 120, 14));
            var meta = new StackPanel { Margin = new Thickness(18, 0, 10, 0), VerticalAlignment = VerticalAlignment.Center };
            meta.Children.Add(Ui.Text("О ТРЕКЕ", 11.5, Ui.Accent, true));
            var tt = Ui.Wrap(t.Title, 22, Ui.TEXT, true); tt.FontFamily = Ui.Display; tt.Margin = new Thickness(0, 6, 0, 4); meta.Children.Add(tt);
            meta.Children.Add(Ui.Wrap(t.Artist, 14, Ui.MUTED));
            Grid.SetColumn(meta, 1); top.Children.Add(meta);
            var close = Ui.IconButton("close", 34, 18, Ui.MUTED, Colors.Transparent, CloseDialog, "Закрыть"); close.VerticalAlignment = VerticalAlignment.Top; Grid.SetColumn(close, 2); top.Children.Add(close);
            sp.Children.Add(top);
            var facts = new StackPanel { Margin = new Thickness(0, 18, 0, 0) }; sp.Children.Add(facts);
            facts.Children.Add(Note("Ищу сведения…"));
            var about = new StackPanel(); sp.Children.Add(about);
            var btns = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 18, 0, 0) };
            btns.Children.Add(Ui.Pill("Страница исполнителя", true, () => { CloseDialog(); CloseNP(); OpenArtistFor(t); }, "user"));
            sp.Children.Add(btns);
            var sv = Ui.Scroll(sp); sv.MaxHeight = Math.Max(400, ActualHeight - 140);
            OpenDialog(sv, 620);

            var info = await Meta.Lookup(t, P.Dur > 0 && P.Cur != null && P.Cur.Key == t.Key ? P.Dur : t.Duration);
            Dictionary<string, object> credits = null;
            if (t.Src == "yt" && P.Cur != null && P.Cur.Key == t.Key) credits = await E.Eng("credits", "videoId", t.VideoId);
            facts.Children.Clear();
            Action<string, string> fact = (k, v) =>
            {
                if (string.IsNullOrEmpty(v)) return;
                var g = new Grid { Margin = new Thickness(0, 0, 0, 10) }; g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(150) }); g.ColumnDefinitions.Add(new ColumnDefinition());
                g.Children.Add(Ui.Text(k, 13, Ui.MUTED)); var vt = Ui.Wrap(v, 13.5, Ui.TEXT, true); Grid.SetColumn(vt, 1); g.Children.Add(vt);
                facts.Children.Add(g);
            };
            fact("Исполнители", info.Artists.Count > 0 ? string.Join(", ", info.Artists) : t.Artist);
            fact("Альбом", info.Album);
            fact("Год выпуска", info.Year);
            fact("Длительность", (P.Cur != null && P.Cur.Key == t.Key && P.Dur > 0) ? Ui.Fmt(P.Dur) : t.Duration > 0 ? Ui.Fmt(t.Duration) : t.DurText);
            fact("Источник", t.Src == "sc" ? "SoundCloud" : t.Src == "local" ? "Файл на компьютере" : "YouTube Music");
            if (credits != null) foreach (var c in J.A(credits, "items")) fact(J.S(c, "role"), J.S(c, "names"));
            foreach (var kv in info.Credits) fact(kv.Key, kv.Value);
            if (facts.Children.Count <= 2) facts.Children.Add(Note("Подробных сведений об этом треке не нашлось"));
            if (info.Bio.Length > 0)
            {
                var h = Ui.Text("Об исполнителе · " + info.BioName, 16, Ui.TEXT, true); h.Margin = new Thickness(0, 12, 0, 8); about.Children.Add(h);
                about.Children.Add(Ui.Wrap(info.Bio, 13.5, Ui.MUTED));
                var src = Ui.Text("Источник: Википедия", 11.5, Ui.FAINT); src.Margin = new Thickness(0, 6, 0, 0); about.Children.Add(src);
            }
        }
    }

    /// <summary>Track facts from MusicBrainz (artists, album, year, credits) and the artist's Wikipedia summary.</summary>
    class Meta
    {
        public List<string> Artists = new List<string>(); public string Album = "", Year = "", Bio = "", BioName = "";
        public List<KeyValuePair<string, string>> Credits = new List<KeyValuePair<string, string>>();
        const string UA = "YouPlay/3 ( https://github.com/delltrxxxx-hub/YouPlay )";
        static string Get(string url)
        {
            try
            {
                System.Net.ServicePointManager.SecurityProtocol = (System.Net.SecurityProtocolType)3072;
                var req = (System.Net.HttpWebRequest)System.Net.WebRequest.Create(url);
                req.UserAgent = UA; req.Accept = "application/json"; req.Timeout = 12000;
                using (var resp = req.GetResponse()) using (var r = new System.IO.StreamReader(resp.GetResponseStream(), System.Text.Encoding.UTF8)) return r.ReadToEnd();
            }
            catch { return ""; }
        }
        public static Task<Meta> Lookup(Track t, double dur)
        {
            return Task.Run(() =>
            {
                var m = new Meta();
                var title = Regex.Replace(t.Title, @"\s*[(\[][^)\]]*(official|video|audio|lyric|remaster|slowed|sped|reverb|mv|hd)[^)\]]*[)\]]", "", RegexOptions.IgnoreCase).Trim();
                var artist = Regex.Split(t.Artist ?? "", @",| и | & | feat\.| ft\.| x ", RegexOptions.IgnoreCase)[0].Trim();
                if (artist.Length > 0 && title.StartsWith(artist, StringComparison.CurrentCultureIgnoreCase)) { var r = Regex.Replace(title.Substring(artist.Length), @"^\s*[—–-]\s*", ""); if (r.Length > 0) title = r; }
                // MusicBrainz recording search
                var q = "recording:\"" + title.Replace("\"", "") + "\"" + (artist.Length > 0 ? " AND artist:\"" + artist.Replace("\"", "") + "\"" : "");
                var j = J.Parse(Get("https://musicbrainz.org/ws/2/recording?fmt=json&limit=8&query=" + Uri.EscapeDataString(q)));
                Dictionary<string, object> best = null; double bestScore = -1e9;
                foreach (var rec in J.A(j, "recordings"))
                {
                    double score = J.D(rec, "score") - (dur > 0 && J.D(rec, "length") > 0 ? Math.Abs(J.D(rec, "length") / 1000 - dur) : 0) * 2;
                    if (J.A(rec, "releases").Count > 0) score += 5;
                    if (score > bestScore) { bestScore = score; best = rec; }
                }
                if (best != null && J.D(best, "score") >= 70)
                {
                    foreach (var ac in J.A(best, "artist-credit")) { var n = J.S(ac, "name"); if (n.Length > 0 && !m.Artists.Contains(n)) m.Artists.Add(n); }
                    var rels = J.A(best, "releases").OrderBy(r => J.S(r, "date").Length >= 4 ? J.S(r, "date") : "9999").ToList();
                    var fr = J.S(best, "first-release-date");
                    m.Year = fr.Length >= 4 ? fr.Substring(0, 4) : rels.Count > 0 && J.S(rels[0], "date").Length >= 4 ? J.S(rels[0], "date").Substring(0, 4) : "";
                    if (rels.Count > 0) m.Album = J.S(rels[0], "title");
                    // credits: writers / producers from the recording's relations
                    var id = J.S(best, "id");
                    if (id.Length > 0)
                    {
                        var rj = J.Parse(Get("https://musicbrainz.org/ws/2/recording/" + id + "?fmt=json&inc=artist-rels+work-rels+work-level-rels"));
                        var roles = new Dictionary<string, List<string>>();
                        Action<string, string> add = (role, name) => { if (string.IsNullOrEmpty(name)) return; List<string> l; if (!roles.TryGetValue(role, out l)) roles[role] = l = new List<string>(); if (!l.Contains(name)) l.Add(name); };
                        foreach (var rel in J.A(rj, "relations"))
                        {
                            var type = J.S(rel, "type"); var a = J.O(rel, "artist");
                            if (a != null) add(RoleName(type), J.S(a, "name"));
                            var w = J.O(rel, "work");
                            if (w != null) foreach (var wr in J.A(w, "relations")) { var wa = J.O(wr, "artist"); if (wa != null) add(RoleName(J.S(wr, "type")), J.S(wa, "name")); }
                        }
                        foreach (var kv in roles) m.Credits.Add(new KeyValuePair<string, string>(kv.Key, string.Join(", ", kv.Value)));
                    }
                }
                if (m.Artists.Count == 0 && t.Artist.Length > 0) m.Artists.AddRange(Regex.Split(t.Artist, @",| и | & | feat\. | ft\. ").Select(x => x.Trim()).Where(x => x.Length > 0));
                // Wikipedia: the main artist (Russian first, then English)
                var who = m.Artists.Count > 0 ? m.Artists[0] : artist;
                foreach (var lang in new[] { "ru", "en" })
                {
                    if (who.Length == 0) break;
                    var w = J.Parse(Get("https://" + lang + ".wikipedia.org/api/rest_v1/page/summary/" + Uri.EscapeDataString(who.Replace(' ', '_'))));
                    var ex = J.S(w, "extract");
                    if (ex.Length > 40 && J.S(w, "type") != "disambiguation" && Regex.IsMatch(ex, "музык|певец|певица|рэпер|группа|исполнител|продюсер|singer|rapper|musician|band|producer|DJ|songwriter|duo", RegexOptions.IgnoreCase)) { m.Bio = ex; m.BioName = J.S(w, "title"); break; }
                }
                return m;
            });
        }
        static string RoleName(string t)
        {
            switch (t)
            {
                case "producer": return "Продюсер";
                case "composer": return "Композитор";
                case "lyricist": return "Автор текста";
                case "writer": return "Автор";
                case "mix": return "Сведение";
                case "mastering": return "Мастеринг";
                case "engineer": case "recording": return "Звукорежиссёр";
                case "vocal": return "Вокал";
                case "instrument": return "Музыканты";
                case "performer": return "Исполнение";
                case "arranger": return "Аранжировка";
                default: return t.Length > 0 ? char.ToUpper(t[0]) + t.Substring(1) : "Участник";
            }
        }
    }
}
