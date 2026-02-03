// Express server for local development / GitHub Codespaces
// This can also be deployed to any Node.js hosting
const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3000;

const XOR_KEY = "AntennaPodProxy2024";
const ENCODED_PREFIX = "px";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cache-tag, x-media-data, range",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, X-Content-Encoding"
};

function xorString(input, key) {
  let result = "";
  for (let i = 0; i < input.length; i++) {
    result += String.fromCharCode(input.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return result;
}

function decodeEncodedUrl(encoded) {
  try {
    let data = encoded;
    if (data.startsWith(ENCODED_PREFIX)) {
      data = data.substring(ENCODED_PREFIX.length);
    }
    let base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    const xored = Buffer.from(base64, 'base64').toString('binary');
    return xorString(xored, XOR_KEY);
  } catch (e) {
    return encoded;
  }
}

function fetchUrl(targetUrl, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...headers
      }
    };

    const req = protocol.request(options, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, targetUrl).href;
        return fetchUrl(redirectUrl, headers).then(resolve).catch(reject);
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks)
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function handleRequest(req, res) {
  // CORS
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const query = parsedUrl.query;
  
  // Get media URL from header or query
  const mediaDataHeader = req.headers['x-cache-tag'] || req.headers['x-media-data'];
  
  const action = query.action || query.t || query.m || 'feed';
  
  try {
    // SEARCH
    if (action === 'search') {
      const searchQuery = query.q || query.query || '';
      const limit = parseInt(query.limit || '25');
      
      const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(searchQuery)}&media=podcast&entity=podcast&limit=${limit}`;
      const response = await fetchUrl(searchUrl);
      const data = JSON.parse(response.body.toString());
      
      const results = (data.results || [])
        .filter(item => item.feedUrl)
        .map(item => ({
          title: item.collectionName || item.trackName || "",
          author: item.artistName || "",
          feedUrl: item.feedUrl,
          imageUrl: item.artworkUrl600 || item.artworkUrl100 || "",
          description: item.description || "",
          genre: item.primaryGenreName || "",
          trackCount: item.trackCount || 0
        }));
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, query: searchQuery, resultCount: results.length, results }));
      return;
    }

    // TOP PODCASTS
    if (action === 'top') {
      const country = query.country || query.cc || 'US';
      const limit = parseInt(query.limit || '25');
      
      const topUrl = `https://itunes.apple.com/${country}/rss/toppodcasts/limit=${limit}/explicit=true/json`;
      const response = await fetchUrl(topUrl);
      const content = response.body.toString();
      const base64Content = Buffer.from(content).toString('base64');
      
      res.writeHead(200, { 
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Encoding': 'base64'
      });
      res.end(base64Content);
      return;
    }

    // STREAM
    if (action === 'stream' || action === 's' || mediaDataHeader) {
      let mediaUrl = '';
      if (mediaDataHeader) {
        mediaUrl = decodeEncodedUrl(mediaDataHeader);
      } else if (query.d) {
        mediaUrl = decodeEncodedUrl(query.d);
      } else if (query.url) {
        mediaUrl = query.url;
      }
      
      if (!mediaUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing media URL' }));
        return;
      }

      const headers = {};
      if (req.headers.range) {
        headers['Range'] = req.headers.range;
      }

      const response = await fetchUrl(mediaUrl, headers);
      
      const responseHeaders = { 'Accept-Ranges': 'bytes' };
      if (response.headers['content-type']) responseHeaders['Content-Type'] = response.headers['content-type'];
      if (response.headers['content-length']) responseHeaders['Content-Length'] = response.headers['content-length'];
      if (response.headers['content-range']) responseHeaders['Content-Range'] = response.headers['content-range'];
      
      res.writeHead(response.statusCode, responseHeaders);
      res.end(response.body);
      return;
    }

    // FEED (default)
    let feedUrl = '';
    if (query.d) {
      feedUrl = decodeEncodedUrl(query.d);
    } else if (query.urlenc) {
      feedUrl = decodeEncodedUrl(query.urlenc);
    } else if (query.url) {
      feedUrl = query.url;
    }
    
    if (!feedUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing feed URL' }));
      return;
    }

    const response = await fetchUrl(feedUrl, {
      'Accept': 'application/rss+xml, application/xml, text/xml, */*'
    });
    
    const content = response.body.toString();
    const base64Content = Buffer.from(content).toString('base64');
    
    res.writeHead(200, { 
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Encoding': 'base64',
      'Cache-Control': 'public, max-age=300'
    });
    res.end(base64Content);

  } catch (error) {
    console.error('Error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
  console.log('');
  console.log('Test endpoints:');
  console.log(`  Search: http://localhost:${PORT}/?action=search&q=tech`);
  console.log(`  Top US: http://localhost:${PORT}/?action=top&country=US`);
  console.log(`  Feed:   http://localhost:${PORT}/?action=feed&url=<feed_url>`);
});
