// Node.js script for GitHub Actions to proxy requests
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const XOR_KEY = "AntennaPodProxy2024";
const ENCODED_PREFIX = "px";

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

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...options.headers
      }
    }, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location, options).then(resolve).catch(reject);
      }
      
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers: res.headers,
          buffer: () => Promise.resolve(Buffer.concat(data)),
          text: () => Promise.resolve(Buffer.concat(data).toString('utf8')),
          json: () => Promise.resolve(JSON.parse(Buffer.concat(data).toString('utf8')))
        });
      });
    });
    req.on('error', reject);
  });
}

async function searchPodcasts(query, limit = 25) {
  const params = new URLSearchParams({ term: query, media: "podcast", entity: "podcast", limit: limit.toString() });
  const response = await fetch(`https://itunes.apple.com/search?${params}`);
  const data = await response.json();
  const results = [];
  for (const item of data.results || []) {
    if (item.feedUrl) {
      results.push({
        title: item.collectionName || item.trackName || "",
        author: item.artistName || "",
        feedUrl: item.feedUrl,
        imageUrl: item.artworkUrl600 || item.artworkUrl100 || "",
        description: item.description || "",
        genre: item.primaryGenreName || "",
        trackCount: item.trackCount || 0,
      });
    }
  }
  return { success: true, query, resultCount: results.length, results };
}

async function getTopPodcasts(country = "US", limit = 25) {
  const url = `https://itunes.apple.com/${country}/rss/toppodcasts/limit=${limit}/explicit=true/json`;
  const response = await fetch(url);
  return await response.json();
}

async function proxyFeed(feedUrl) {
  const response = await fetch(feedUrl, {
    headers: { 'Accept': 'application/rss+xml, application/xml, text/xml, */*' }
  });
  const content = await response.text();
  return Buffer.from(content, 'utf8').toString('base64');
}

async function proxyMedia(mediaUrl) {
  const response = await fetch(mediaUrl, {
    headers: { 'Accept': '*/*' }
  });
  const buffer = await response.buffer();
  return {
    data: buffer.toString('base64'),
    contentType: response.headers['content-type'] || 'audio/mpeg',
    contentLength: buffer.length
  };
}

async function main() {
  const action = process.env.ACTION || 'top';
  const outputDir = process.env.OUTPUT_DIR || './output';
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    let result;
    let filename;

    switch (action) {
      case 'search':
        const query = process.env.QUERY || '';
        const limit = parseInt(process.env.LIMIT || '25');
        result = await searchPodcasts(query, limit);
        filename = `search_${Buffer.from(query).toString('base64').replace(/[^a-zA-Z0-9]/g, '')}.json`;
        break;

      case 'top':
        const country = process.env.COUNTRY || 'US';
        const topLimit = parseInt(process.env.LIMIT || '25');
        result = await getTopPodcasts(country, topLimit);
        filename = `top_${country}.json`;
        break;

      case 'feed':
        const feedUrl = process.env.URL ? decodeEncodedUrl(process.env.URL) : '';
        if (!feedUrl) throw new Error('Missing URL');
        const feedContent = await proxyFeed(feedUrl);
        result = { encoding: 'base64', content: feedContent };
        filename = `feed_${Date.now()}.json`;
        break;

      case 'stream':
        const mediaUrl = process.env.URL ? decodeEncodedUrl(process.env.URL) : '';
        if (!mediaUrl) throw new Error('Missing URL');
        const mediaResult = await proxyMedia(mediaUrl);
        result = mediaResult;
        filename = `media_${Date.now()}.json`;
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    const outputPath = path.join(outputDir, filename);
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`Output written to: ${outputPath}`);
    
    // Also write to a predictable location for the latest result
    const latestPath = path.join(outputDir, `latest_${action}.json`);
    fs.writeFileSync(latestPath, JSON.stringify(result, null, 2));
    console.log(`Latest written to: ${latestPath}`);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
