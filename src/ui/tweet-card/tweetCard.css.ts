/**
 * Rich post card, shared by the page overlay and the side panel. Every colour
 * is a `--xf-*` token, so the card follows X's theme wherever it is mounted.
 */
export const TWEET_CARD_CSS = `
.xf-tc { display: flex; gap: 12px; padding: 12px 16px; cursor: pointer; color: var(--xf-text); }
.xf-tc-main { flex: 1 1 auto; min-width: 0; }

.xf-tc-avatar {
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  border-radius: 9999px;
  object-fit: cover;
  background: var(--xf-hover);
}
.xf-tc-avatar-small { width: 20px; height: 20px; }
.xf-tc-avatar-empty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: var(--xf-text-muted);
  background: var(--xf-border);
}
.xf-tc-avatar-small.xf-tc-avatar-empty { font-size: 11px; }

.xf-tc-head { display: flex; align-items: center; gap: 4px; min-width: 0; font-size: 15px; line-height: 20px; }
.xf-tc-name { min-width: 0; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.xf-tc-handle { min-width: 0; color: var(--xf-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.xf-tc-time { flex: 0 0 auto; color: var(--xf-text-muted); text-decoration: none; white-space: nowrap; }
.xf-tc-time:hover { text-decoration: underline; }
.xf-tc-actions { flex: 0 0 auto; display: inline-flex; margin: -4px 0 -4px auto; }

.xf-tc-verified {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 9999px;
  background: var(--xf-accent);
  color: #fff;
}

.xf-tc-text { margin-top: 2px; font-size: 15px; line-height: 20px; white-space: pre-wrap; overflow-wrap: anywhere; }
.xf-tc-link, .xf-tc-more { color: var(--xf-accent); text-decoration: none; }
.xf-tc-link:hover, .xf-tc-more:hover { text-decoration: underline; }

.xf-tc-media {
  display: grid;
  gap: 2px;
  margin-top: 12px;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--xf-border);
  border-radius: 16px;
  overflow: hidden;
}
.xf-tc-media[data-count="1"] { grid-template: 1fr / 1fr; }
.xf-tc-media[data-count="2"] { grid-template: 1fr / 1fr 1fr; }
.xf-tc-media[data-count="3"], .xf-tc-media[data-count="4"] { grid-template: 1fr 1fr / 1fr 1fr; }
.xf-tc-media[data-count="3"] > :first-child { grid-row: span 2; }
.xf-tc-media-cell { position: relative; min-width: 0; min-height: 0; }
.xf-tc-media-cell .xf-tc-img { display: block; width: 100%; height: 100%; object-fit: cover; }
.xf-tc-play {
  position: absolute;
  top: 50%;
  left: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin: -24px 0 0 -24px;
  border: 3px solid #fff;
  border-radius: 9999px;
  background: var(--xf-accent);
  color: #fff;
}
.xf-tc-gif {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 0 4px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.77);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  line-height: 16px;
}
.xf-tc-img-missing { display: block; background: var(--xf-border); }

.xf-tc-quote { margin-top: 12px; padding: 12px; border: 1px solid var(--xf-border); border-radius: 16px; }
.xf-tc-quote-head { display: flex; align-items: center; gap: 4px; min-width: 0; font-size: 15px; line-height: 20px; }
.xf-tc-quote-body { display: flex; gap: 12px; margin-top: 4px; }
.xf-tc-quote-thumb { flex: 0 0 auto; width: 64px; height: 64px; border-radius: 8px; object-fit: cover; }
.xf-tc-quote-text {
  min-width: 0;
  font-size: 15px;
  line-height: 20px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.xf-tc-card {
  display: block;
  margin-top: 12px;
  border: 1px solid var(--xf-border);
  border-radius: 16px;
  overflow: hidden;
  color: inherit;
  text-decoration: none;
}
.xf-tc-card-img { display: block; width: 100%; aspect-ratio: 1.91 / 1; object-fit: cover; }
.xf-tc-card-text { display: flex; flex-direction: column; gap: 2px; padding: 12px; font-size: 15px; line-height: 20px; }
.xf-tc-card-domain { color: var(--xf-text-muted); }
.xf-tc-card-title {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.xf-tc-card[data-layout="small"] { display: flex; }
.xf-tc-card[data-layout="small"] .xf-tc-card-img { flex: 0 0 auto; width: 130px; aspect-ratio: 1 / 1; }
.xf-tc-card[data-layout="small"] .xf-tc-card-text { justify-content: center; min-width: 0; }

.xf-tc-saved { margin-top: 12px; font-size: 13px; color: var(--xf-text-muted); }
`;
