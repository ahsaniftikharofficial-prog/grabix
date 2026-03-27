interface IconProps { size?: number; color?: string; className?: string; style?: React.CSSProperties; }
const I = ({ size = 16, color = "currentColor", className = "", style, d }: IconProps & { d: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <path d={d} />
  </svg>
);
const SI = ({ size = 16, color = "currentColor", className = "", style, children }: IconProps & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>{children}</svg>
);

export const IconDownload   = (p: IconProps) => <I {...p} d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />;
export const IconLibrary    = (p: IconProps) => <SI {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></SI>;
export const IconSettings   = (p: IconProps) => <SI {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></SI>;
export const IconBrowse     = (p: IconProps) => <SI {...p}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></SI>;
export const IconSearch     = (p: IconProps) => <SI {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></SI>;
export const IconPaste      = (p: IconProps) => <SI {...p}><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></SI>;
export const IconLink       = (p: IconProps) => <SI {...p}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></SI>;
export const IconVideo      = (p: IconProps) => <SI {...p}><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></SI>;
export const IconAudio      = (p: IconProps) => <SI {...p}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></SI>;
export const IconImage      = (p: IconProps) => <SI {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></SI>;
export const IconSubtitle   = (p: IconProps) => <SI {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="14" y2="14"/></SI>;
export const IconScissors   = (p: IconProps) => <SI {...p}><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></SI>;
export const IconX          = (p: IconProps) => <I {...p} d="M18 6L6 18M6 6l12 12" />;
export const IconCheck      = (p: IconProps) => <I {...p} d="M20 6L9 17l-5-5" />;
export const IconRefresh    = (p: IconProps) => <SI {...p}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></SI>;
export const IconFolder     = (p: IconProps) => <SI {...p}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></SI>;
export const IconTrash      = (p: IconProps) => <SI {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></SI>;
export const IconHeart      = ({ size = 16, color = "currentColor", style, filled = false }: IconProps & { filled?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : "none"} stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
  </svg>
);
export const IconMoon       = (p: IconProps) => <I {...p} d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />;
export const IconSun        = (p: IconProps) => <SI {...p}><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></SI>;
export const IconChevronDown = (p: IconProps) => <I {...p} d="M6 9l6 6 6-6" />;
export const IconPlay       = (p: IconProps) => <SI {...p}><polygon points="5 3 19 12 5 21 5 3"/></SI>;
export const IconPause      = (p: IconProps) => <SI {...p}><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></SI>;
export const IconStop       = (p: IconProps) => <SI {...p}><rect x="3" y="3" width="18" height="18" rx="2"/></SI>;
export const IconInfo       = (p: IconProps) => <SI {...p}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></SI>;
export const IconClock      = (p: IconProps) => <SI {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></SI>;
export const IconStar       = (p: IconProps) => <SI {...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></SI>;
export const IconFilter     = (p: IconProps) => <I {...p} d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />;
export const IconGrid       = (p: IconProps) => <SI {...p}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></SI>;
export const IconList       = (p: IconProps) => <SI {...p}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></SI>;
export const IconMoreVert   = (p: IconProps) => <SI {...p}><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></SI>;
export const IconWifi       = (p: IconProps) => <SI {...p}><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 16 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></SI>;
export const IconAlert      = (p: IconProps) => <SI {...p}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></SI>;
export const IconConvert    = (p: IconProps) => <SI {...p}><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></SI>;
export const IconHardDrive  = (p: IconProps) => <SI {...p}><line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/></SI>;
export const IconUpload     = (p: IconProps) => <SI {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></SI>;
export const IconExpand     = (p: IconProps) => <SI {...p}><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><polyline points="21 15 21 21 15 21"/><polyline points="3 9 3 3 9 3"/></SI>;
export const IconServers    = (p: IconProps) => <SI {...p}><rect x="3" y="4" width="18" height="5" rx="1.5"/><rect x="3" y="10" width="18" height="5" rx="1.5"/><rect x="3" y="16" width="18" height="5" rx="1.5"/><line x1="7" y1="6.5" x2="7.01" y2="6.5"/><line x1="7" y1="12.5" x2="7.01" y2="12.5"/><line x1="7" y1="18.5" x2="7.01" y2="18.5"/></SI>;
