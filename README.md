# AntennaPod Podcast Proxy

A GitHub Pages + Actions based proxy for podcast feeds and media.

## How it Works

1. **GitHub Actions** runs every hour to fetch and cache top podcasts
2. **GitHub Pages** serves the cached content as static JSON files
3. The Android app fetches from `https://YOUR_USERNAME.github.io/podcast-proxy/api/`

## Setup

1. Create a new GitHub repository named `podcast-proxy`
2. Copy all files from this folder to the repository
3. Enable GitHub Pages:
   - Go to Settings → Pages
   - Source: Deploy from a branch
   - Branch: `main`, folder: `/docs`
4. Wait for the first GitHub Action run (or trigger manually)

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `/api/top_US.json` | Top US podcasts |
| `/api/top_IL.json` | Top Israel podcasts |
| `/api/latest_search.json` | Latest search results |
| `/api/latest_feed.json` | Latest feed fetch |

## Triggering On-Demand Requests

### Via GitHub UI
1. Go to Actions tab
2. Select "Podcast Proxy" workflow
3. Click "Run workflow"
4. Fill in the parameters

### Via API (requires personal access token)
```bash
curl -X POST \
  -H "Authorization: token YOUR_GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/YOUR_USERNAME/podcast-proxy/dispatches \
  -d '{"event_type":"proxy-request","client_payload":{"action":"search","query":"tech news"}}'
```

## For Media Streaming

Media streaming is more complex because files can be large. Options:
1. Use smaller chunk requests
2. Cache popular episodes
3. Use GitHub Releases for larger files

## License

MIT
