export interface MediaItem {
  id: number; title: string; channel: string;
  duration: string; thumb: string; format: string; size: string;
}
export interface QueueItem {
  id: number; title: string; format: string; size: string;
  progress: number; speed: string; eta: string;
  status: "downloading" | "paused" | "done" | "failed";
  thumb: string;
}
export interface ContentItem {
  id: number; title: string; genre: string;
  rating: number; year: number; thumb: string;
}

export const recentDownloads: MediaItem[] = [
  { id:1, title:"Interstellar", channel:"Warner Bros", duration:"2h 49m", thumb:"https://picsum.photos/seed/inter/320/200", format:"MP4 1080p", size:"4.2 GB" },
  { id:2, title:"Attack on Titan S4 Ep12", channel:"Crunchyroll", duration:"24m", thumb:"https://picsum.photos/seed/aot4/320/200", format:"MP4 720p", size:"340 MB" },
  { id:3, title:"Lo-Fi Hip Hop Mix", channel:"ChilledCow", duration:"1h 2m", thumb:"https://picsum.photos/seed/lofi2/320/200", format:"MP3", size:"92 MB" },
  { id:4, title:"Dune Part Two", channel:"HBO Max", duration:"2h 46m", thumb:"https://picsum.photos/seed/dune22/320/200", format:"MP4 4K", size:"18 GB" },
  { id:5, title:"Jujutsu Kaisen S2 Ep5", channel:"Crunchyroll", duration:"23m", thumb:"https://picsum.photos/seed/jjk2/320/200", format:"MP4 1080p", size:"310 MB" },
]

export const queueItems: QueueItem[] = [
  { id:1, title:"Oppenheimer 2023", format:"MP4 4K", size:"22 GB", progress:67, speed:"12.4 MB/s", eta:"14m", status:"downloading", thumb:"https://picsum.photos/seed/opp2/320/200" },
  { id:2, title:"One Piece Episode 1000", format:"MP4 1080p", size:"380 MB", progress:100, speed:"", eta:"Done", status:"done", thumb:"https://picsum.photos/seed/op10/320/200" },
  { id:3, title:"Inception OST", format:"MP3 320kbps", size:"120 MB", progress:0, speed:"", eta:"Paused", status:"paused", thumb:"https://picsum.photos/seed/incept2/320/200" },
  { id:4, title:"Breaking Bad S5 E16", format:"MP4 1080p", size:"1.2 GB", progress:34, speed:"8.1 MB/s", eta:"2m", status:"downloading", thumb:"https://picsum.photos/seed/bb2/320/200" },
  { id:5, title:"Tenet 2020", format:"MP4 720p", size:"2.8 GB", progress:0, speed:"", eta:"Failed", status:"failed", thumb:"https://picsum.photos/seed/tenet2/320/200" },
]

export const libraryItems = [
  { id:1, title:"Interstellar", type:"Video", size:"4.2 GB", date:"2024-03-10", thumb:"https://picsum.photos/seed/inter/320/200" },
  { id:2, title:"Attack on Titan S4", type:"Video", size:"340 MB", date:"2024-03-09", thumb:"https://picsum.photos/seed/aot4/320/200" },
  { id:3, title:"Lo-Fi Hip Hop Mix", type:"Audio", size:"92 MB", date:"2024-03-08", thumb:"https://picsum.photos/seed/lofi2/320/200" },
  { id:4, title:"Dune Part Two", type:"Video", size:"18 GB", date:"2024-03-07", thumb:"https://picsum.photos/seed/dune22/320/200" },
  { id:5, title:"Jujutsu Kaisen S2", type:"Video", size:"310 MB", date:"2024-03-06", thumb:"https://picsum.photos/seed/jjk2/320/200" },
  { id:6, title:"Oppenheimer", type:"Video", size:"22 GB", date:"2024-03-05", thumb:"https://picsum.photos/seed/opp2/320/200" },
  { id:7, title:"Studio Ghibli Mix", type:"Audio", size:"88 MB", date:"2024-03-04", thumb:"https://picsum.photos/seed/ghibli2/320/200" },
  { id:8, title:"Demon Slayer Movie", type:"Video", size:"1.8 GB", date:"2024-03-03", thumb:"https://picsum.photos/seed/ds2/320/200" },
]

export const animeList: ContentItem[] = [
  { id:1, title:"Jujutsu Kaisen", genre:"Action, Fantasy", rating:8.7, year:2020, thumb:"https://picsum.photos/seed/jjka2/280/400" },
  { id:2, title:"Demon Slayer", genre:"Action, Drama", rating:8.7, year:2019, thumb:"https://picsum.photos/seed/dsa2/280/400" },
  { id:3, title:"Attack on Titan", genre:"Action, Drama", rating:9.0, year:2013, thumb:"https://picsum.photos/seed/aota2/280/400" },
  { id:4, title:"Chainsaw Man", genre:"Action, Horror", rating:8.5, year:2022, thumb:"https://picsum.photos/seed/csm2/280/400" },
  { id:5, title:"Spy x Family", genre:"Action, Comedy", rating:8.4, year:2022, thumb:"https://picsum.photos/seed/sxf2/280/400" },
  { id:6, title:"One Piece", genre:"Adventure", rating:8.9, year:1999, thumb:"https://picsum.photos/seed/opa2/280/400" },
]

export const mangaList = [
  { id:1, title:"Berserk", genre:"Dark Fantasy", rating:9.4, thumb:"https://picsum.photos/seed/ber2/280/400" },
  { id:2, title:"Vinland Saga", genre:"Historical", rating:8.8, thumb:"https://picsum.photos/seed/vs2/280/400" },
  { id:3, title:"Vagabond", genre:"Samurai", rating:9.2, thumb:"https://picsum.photos/seed/vag2/280/400" },
  { id:4, title:"Blue Period", genre:"Drama", rating:8.5, thumb:"https://picsum.photos/seed/bp2/280/400" },
]

export const moviesList: ContentItem[] = [
  { id:1, title:"Dune: Part Two", genre:"Sci-Fi, Adventure", rating:8.6, year:2024, thumb:"https://picsum.photos/seed/dunem2/280/400" },
  { id:2, title:"Oppenheimer", genre:"Drama, History", rating:8.9, year:2023, thumb:"https://picsum.photos/seed/oppm2/280/400" },
  { id:3, title:"The Batman", genre:"Action, Crime", rating:7.9, year:2022, thumb:"https://picsum.photos/seed/batm2/280/400" },
  { id:4, title:"Everything Everywhere", genre:"Sci-Fi, Comedy", rating:8.0, year:2022, thumb:"https://picsum.photos/seed/eeaao2/280/400" },
  { id:5, title:"Past Lives", genre:"Romance, Drama", rating:7.9, year:2023, thumb:"https://picsum.photos/seed/pastl2/280/400" },
  { id:6, title:"Killers of Flower Moon", genre:"Crime, Drama", rating:7.7, year:2023, thumb:"https://picsum.photos/seed/kfm2/280/400" },
]
