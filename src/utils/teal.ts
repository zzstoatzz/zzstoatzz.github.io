export interface TealPlay {
    trackName: string;
    artists?: { artistName: string }[];
    originUri?: string;
    playedTime?: string;
}

export function playHref(play: TealPlay): string | undefined {
    const uri = play.originUri;
    return uri && /^https?:\/\//.test(uri) ? uri : undefined;
}

export function plyrEmbedUrl(play: TealPlay): string | undefined {
    const match = playHref(play)?.match(/^https:\/\/plyr\.fm\/track\/([^/?#]+)/);
    return match ? `https://plyr.fm/embed/track/${match[1]}` : undefined;
}
