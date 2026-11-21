using System;
using System.Collections.Generic;
using System.Linq;

namespace YouPlay
{
    /// <summary>One queue for YouTube Music (hidden page), SoundCloud (widget) and files (audio page).</summary>
    class Player
    {
        readonly Engine E;
        public List<Track> List = new List<Track>();
        public int I = -1; public string Name = "";
        public Track Cur;
        public bool Playing, Shuffle, Radio;
        public int Repeat;   // 0 off, 1 all, 2 one
        public double Time, Dur;
        public event Action TrackChanged, StateChanged;
        public Func<Track, bool> IsDisliked = t => false;
        DateTime scTick = DateTime.MinValue;
        static readonly Random rnd = new Random();

        public Player(Engine e)
        {
            E = e;
            E.State += OnYtState;
            E.Ended += id => { if (Cur != null && Cur.Src == "yt" && id == Cur.VideoId) Next(true); };
            E.PlayerEvent += OnPage;
        }

        public void PlayList(List<Track> l, int at, string name)
        {
            if (l == null || l.Count == 0) return;
            var want = at >= 0 && at < l.Count ? l[at] : null;
            List = l.Where(t => t.Playable).Select(t => t.Copy()).ToList();
            if (List.Count == 0) return;
            int k = 0; if (want != null) for (int j = 0; j < List.Count; j++) if (List[j].Key == want.Key) { k = j; break; }
            Name = name ?? ""; Radio = false;
            if (Shuffle) { var first = List[k]; List.RemoveAt(k); List = List.OrderBy(x => rnd.Next()).ToList(); List.Insert(0, first); k = 0; }
            PlayAt(k);
        }
        public void AddNext(Track t) { if (Cur == null) { PlayList(new List<Track> { t }, 0, "Очередь"); return; } List.Insert(I + 1, t.Copy()); }
        public void PlayAt(int k)
        {
            if (k < 0 || k >= List.Count) return;
            var t = List[k];
            if (IsDisliked(t)) { if (k + 1 < List.Count) PlayAt(k + 1); return; }
            StopAll(t.Src);
            I = k; Cur = t; Time = 0; Dur = t.Duration; Playing = true;
            if (t.Src == "yt") { E.Control("expectEnd", "value", true); E.Eng("play", "videoId", t.VideoId); }
            else if (t.Src == "sc") E.ScLoad(t.Url);
            else E.PlayLocal(t.Id);
            if (TrackChanged != null) TrackChanged();
        }
        void StopAll(string except)
        {
            if (Cur == null) return;
            if (Cur.Src == "yt" && except != "yt") E.Control("pause");
            if (Cur.Src != "yt" && except == "yt") E.StopPage();
        }
        public void Next(bool auto)
        {
            if (Repeat == 2 && auto) { Seek(0); Resume(); return; }
            if (I + 1 < List.Count) PlayAt(I + 1);
            else if (Repeat == 1 && List.Count > 0) PlayAt(0);
            else if (Cur != null && Cur.Src == "yt") { E.Control("expectEnd", "value", false); E.Control("next"); Radio = true; }
            else Pause();
        }
        public void Prev() { if (Time > 3) Seek(0); else if (I > 0) PlayAt(I - 1); else Seek(0); }
        public void Toggle() { if (Playing) Pause(); else Resume(); }
        public void Pause() { if (Cur == null) return; if (Cur.Src == "yt") E.Control("pause"); else E.PlCmd(Cur.Src, "pause", 0); Playing = false; Changed(); }
        public void Resume() { if (Cur == null) return; if (Cur.Src == "yt") E.Control("play"); else E.PlCmd(Cur.Src, "play", 0); Playing = true; Changed(); }
        public void Seek(double t) { if (Cur == null) return; Time = t; if (Cur.Src == "yt") E.Control("seek", "time", t); else E.PlCmd(Cur.Src, "seek", t); Changed(); }
        void Changed() { if (StateChanged != null) StateChanged(); }

        /// <summary>Called often by the window: keeps SoundCloud time moving between widget updates.</summary>
        public void Tick()
        {
            if (Cur != null && Cur.Src == "sc" && Playing) { var now = DateTime.Now; if (scTick != DateTime.MinValue) Time += (now - scTick).TotalSeconds; scTick = now; }
            else scTick = DateTime.MinValue;
        }

        void OnYtState(Dictionary<string, object> s)
        {
            var vid = J.S(s, "videoId");
            if (Cur == null || Cur.Src != "yt") { if (Radio && vid.Length > 0 && J.B(s, "playing")) Adopt(s); else return; }
            if (Radio && vid.Length > 0 && vid != Cur.VideoId && J.S(s, "title").Length > 0) Adopt(s);
            if (vid.Length > 0 && vid != Cur.VideoId) return;
            Playing = J.B(s, "playing"); Time = J.D(s, "time"); var d = J.D(s, "dur"); if (d > 0) Dur = d;
            if (Cur.Art.Length == 0) Cur.Art = J.S(s, "art");
            if (Cur.Title.Length == 0) Cur.Title = J.S(s, "title");
            bool likeChanged = Cur.Liked != J.B(s, "liked") || Cur.Disliked != J.B(s, "disliked");
            Cur.Liked = J.B(s, "liked"); Cur.Disliked = J.B(s, "disliked");
            if (likeChanged && TrackChanged != null) TrackChanged(); else Changed();
        }
        void Adopt(Dictionary<string, object> s)
        {
            var t = new Track { Src = "yt", VideoId = J.S(s, "videoId"), Title = J.S(s, "title"), Artist = Track.CleanArtist(J.S(s, "artist")), Art = J.S(s, "art") };
            List.Add(t); I = List.Count - 1; Cur = t;
            if (TrackChanged != null) TrackChanged();
        }
        void OnPage(Dictionary<string, object> ev)
        {
            if (Cur == null || Cur.Src != J.S(ev, "src")) return;
            var e = J.S(ev, "ev");
            if (e == "play") { Playing = true; Changed(); }
            else if (e == "pause") { Playing = false; Changed(); }
            else if (e == "progress") { Time = J.D(ev, "pos"); var d = J.D(ev, "dur"); if (d > 0) Dur = d; scTick = DateTime.Now; if (!Playing && Cur.Src == "sc") { Playing = true; Changed(); } }
            else if (e == "sound") { var d = J.D(ev, "dur"); if (d > 0) Dur = d; var a = J.S(ev, "art"); if (Cur.Art.Length == 0 && a.Length > 0) { Cur.Art = a.Replace("-large.", "-t500x500."); if (TrackChanged != null) TrackChanged(); } }
            else if (e == "finish") Next(true);
            else if (e == "error") System.Threading.Tasks.Task.Delay(500).ContinueWith(_ => System.Windows.Application.Current.Dispatcher.BeginInvoke((Action)(() => Next(true))));
        }
    }
}
