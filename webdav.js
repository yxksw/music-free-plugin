/*
 * WebDAV Plugin for MusicFree
 * 支持连接 WebDAV 服务器播放音乐
 * 支持读取音频文件内置标签（ID3、封面等）
 */

"use strict";

// 缓存数据
let cachedData = {
  client: null,
  url: null,
  username: null,
  password: null,
  searchPath: null,
  searchPathList: null,
  cacheFileList: null,
  lastFetchTime: 0,
  lyric: {},
  metadata: {}, // 元数据缓存
};

// 缓存有效期（1小时）
const CACHE_TTL = 60 * 60 * 1000;

// 支持的音频格式
const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma', '.ape', '.opus'];

/**
 * 获取文件扩展名
 */
function getExtension(filename) {
  const lastDot = filename.lastIndexOf('.');
  return lastDot === -1 ? '' : filename.substring(lastDot).toLowerCase();
}

/**
 * 检查文件是否为音频文件
 */
function isAudioFile(filename) {
  return AUDIO_EXTENSIONS.includes(getExtension(filename));
}

/**
 * 从文件名解析歌曲信息
 * 支持 "艺术家 - 标题" 格式
 */
function parseMusicInfo(filename) {
  const lastSlash = filename.lastIndexOf('/');
  const name = lastSlash === -1 ? filename : filename.substring(lastSlash + 1);
  const lastDot = name.lastIndexOf('.');
  const nameWithoutExt = lastDot === -1 ? name : name.substring(0, lastDot);

  // 尝试解析 "艺术家 - 标题" 格式
  const match = nameWithoutExt.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (match) {
    return {
      artist: match[1].trim(),
      title: match[2].trim()
    };
  }
  // 默认使用文件名作为标题
  return {
    artist: "未知艺术家",
    title: nameWithoutExt.trim()
  };
}

/**
 * 获取或创建WebDAV客户端
 */
function getClient() {
  // 从环境变量获取配置
  const userVars = env.getUserVariables
    ? env.getUserVariables()
    : env.userVariables || {};
  const { url, username, password, searchPath } = userVars;

  // 验证必要配置
  if (!url || !username || !password) {
    console.error("WebDAV配置不完整");
    return null;
  }

  // 检查配置是否变更
  const configChanged =
    cachedData.url !== url ||
    cachedData.username !== username ||
    cachedData.password !== password ||
    cachedData.searchPath !== searchPath;

  if (configChanged || !cachedData.client) {
    // 更新缓存数据
    cachedData = {
      client: null,
      url,
      username,
      password,
      searchPath: searchPath || null,
      searchPathList: searchPath
        ? searchPath
            .split(",")
            .map((path) => path.trim())
            .filter(Boolean)
        : ["/"],
      cacheFileList: null,
      lastFetchTime: 0,
      lyric: {},
      metadata: {},
    };

    // 创建新的WebDAV客户端
    try {
      const { createClient, AuthType } = require("webdav");
      cachedData.client = createClient(url, {
        authType: AuthType.Password,
        username,
        password,
      });
    } catch (error) {
      console.error("创建WebDAV客户端失败:", error);
      return null;
    }
  }

  return cachedData.client;
}

/**
 * 获取目录下的所有音频文件
 * 支持递归搜索子目录
 */
async function getAudioFilesFromDirectory(client, path, recursive = true) {
  try {
    const items = await client.getDirectoryContents(path);
    const audioFiles = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type === "directory" && recursive) {
        // 递归搜索子目录
        const subDirFiles = await getAudioFilesFromDirectory(
          client,
          item.filename,
          recursive,
        );
        audioFiles.push(...subDirFiles);
      } else if (
        item.type === "file" &&
        (item.mime && item.mime.startsWith("audio") || isAudioFile(item.basename))
      ) {
        audioFiles.push(item);
      }
    }

    return audioFiles;
  } catch (error) {
    console.error(`获取目录 ${path} 内容失败:`, error);
    return [];
  }
}

/**
 * 读取文件头部数据（用于解析元数据）
 */
async function readFileHead(client, filePath, size) {
  try {
    // 使用 axios 进行 range 请求
    const axios = require("axios");
    const downloadLink = client.getFileDownloadLink(filePath);
    
    const response = await axios.get(downloadLink, {
      headers: {
        Range: `bytes=0-${size - 1}`,
      },
      responseType: "arraybuffer",
      timeout: 10000,
    });
    
    return new Uint8Array(response.data);
  } catch (error) {
    console.error(`读取文件头部失败 ${filePath}:`, error.message);
    return null;
  }
}

/**
 * 将 Uint8Array 转换为字符串
 */
function bytesToString(bytes, start, length, encoding) {
  try {
    const slice = [];
    for (let i = 0; i < length && start + i < bytes.length; i++) {
      slice.push(bytes[start + i]);
    }
    
    if (encoding === "utf-16le") {
      let result = "";
      for (let i = 0; i < slice.length; i += 2) {
        const code = slice[i] | (slice[i + 1] << 8);
        if (code !== 0) result += String.fromCharCode(code);
      }
      return result;
    } else if (encoding === "utf-16be" || encoding === "utf-16") {
      let result = "";
      for (let i = 0; i < slice.length; i += 2) {
        const code = (slice[i] << 8) | slice[i + 1];
        if (code !== 0) result += String.fromCharCode(code);
      }
      return result;
    } else {
      // UTF-8 or ISO-8859-1
      let result = "";
      for (let i = 0; i < slice.length; i++) {
        if (slice[i] !== 0) result += String.fromCharCode(slice[i]);
      }
      return result;
    }
  } catch (e) {
    let result = "";
    for (let i = 0; i < length && start + i < bytes.length; i++) {
      const byte = bytes[start + i];
      if (byte !== 0) result += String.fromCharCode(byte);
    }
    return result;
  }
}

/**
 * 同步安全的字符串转换
 */
function bytesToStringSync(bytes, start, length) {
  let result = "";
  for (let i = 0; i < length && start + i < bytes.length; i++) {
    const byte = bytes[start + i];
    if (byte === 0) break;
    result += String.fromCharCode(byte);
  }
  return result;
}

/**
 * 同步读取同步安全整数
 */
function readSyncSafeInt(bytes, start) {
  return (bytes[start] << 21) | (bytes[start + 1] << 14) | (bytes[start + 2] << 7) | bytes[start + 3];
}

/**
 * 读取大端序整数
 */
function readInt32BE(bytes, start) {
  return (bytes[start] << 24) | (bytes[start + 1] << 16) | (bytes[start + 2] << 8) | bytes[start + 3];
}

/**
 * 解析 ID3v2 标签
 */
function parseID3v2(bytes) {
  const metadata = {
    title: "",
    artist: "",
    album: "",
    year: "",
    comment: "",
    track: "",
    genre: "",
    hasCover: false,
    coverUrl: "",
  };

  try {
    // 检查 ID3 标识 "ID3"
    if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
      return metadata;
    }

    const version = bytes[3]; // 版本号 2, 3, 或 4
    const flags = bytes[5];
    const size = readSyncSafeInt(bytes, 6);
    
    let offset = 10;
    const extendedHeader = (flags & 0x40) !== 0;
    
    if (extendedHeader) {
      const extSize = readInt32BE(bytes, offset);
      offset += 4 + extSize;
    }

    // 解析各个帧
    while (offset < size + 10 && offset < bytes.length - 10) {
      let frameId, frameSize, frameFlags;
      
      if (version >= 3) {
        // ID3v2.3 和 v2.4
        frameId = bytesToStringSync(bytes, offset, 4);
        if (frameId.length !== 4 || !/^[A-Z0-9]+$/.test(frameId)) break;
        
        frameSize = version === 4 ? readSyncSafeInt(bytes, offset + 4) : readInt32BE(bytes, offset + 4);
        frameFlags = (bytes[offset + 8] << 8) | bytes[offset + 9];
        offset += 10;
      } else {
        // ID3v2.2
        frameId = bytesToStringSync(bytes, offset, 3);
        if (frameId.length !== 3 || !/^[A-Z0-9]+$/.test(frameId)) break;
        
        frameSize = (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5];
        offset += 6;
      }

      if (frameSize <= 0 || offset + frameSize > bytes.length) break;

      // 解析帧内容
      const encoding = bytes[offset];
      let textEncoding = "iso-8859-1";
      if (encoding === 1) textEncoding = "utf-16le";
      else if (encoding === 2) textEncoding = "utf-16be";
      else if (encoding === 3) textEncoding = "utf-8";

      const content = bytesToString(bytes, offset + 1, frameSize - 1, textEncoding);

      // 映射常见帧
      const frameMap = {
        "TIT2": "title",
        "TT2": "title",
        "TPE1": "artist",
        "TP1": "artist",
        "TALB": "album",
        "TAL": "album",
        "TYER": "year",
        "TYE": "year",
        "TDRC": "year",
        "TRCK": "track",
        "TRK": "track",
        "TCON": "genre",
        "TCO": "genre",
        "COMM": "comment",
        "COM": "comment",
      };

      if (frameMap[frameId]) {
        metadata[frameMap[frameId]] = content;
      }

      // 检测封面图片
      if (frameId === "APIC" || frameId === "PIC") {
        metadata.hasCover = true;
      }

      offset += frameSize;
    }

    return metadata;
  } catch (error) {
    console.error("解析 ID3v2 标签失败:", error);
    return metadata;
  }
}

/**
 * 解析 ID3v1 标签
 */
function parseID3v1(bytes) {
  const metadata = {
    title: "",
    artist: "",
    album: "",
    year: "",
    comment: "",
    track: "",
    genre: "",
  };

  try {
    if (bytes.length < 128) return metadata;
    
    const offset = bytes.length - 128;
    
    // 检查 "TAG" 标识
    if (bytes[offset] !== 0x54 || bytes[offset + 1] !== 0x41 || bytes[offset + 2] !== 0x47) {
      return metadata;
    }

    metadata.title = bytesToStringSync(bytes, offset + 3, 30).trim();
    metadata.artist = bytesToStringSync(bytes, offset + 33, 30).trim();
    metadata.album = bytesToStringSync(bytes, offset + 63, 30).trim();
    metadata.year = bytesToStringSync(bytes, offset + 93, 4).trim();
    
    // 检查是否有音轨号 (ID3v1.1)
    if (bytes[offset + 125] === 0 && bytes[offset + 126] !== 0) {
      metadata.track = String(bytes[offset + 126]);
      metadata.comment = bytesToStringSync(bytes, offset + 97, 28).trim();
    } else {
      metadata.comment = bytesToStringSync(bytes, offset + 97, 30).trim();
    }

    return metadata;
  } catch (error) {
    return metadata;
  }
}

/**
 * 获取音频文件元数据
 */
async function getAudioMetadata(client, filePath) {
  // 检查缓存
  if (cachedData.metadata[filePath]) {
    return cachedData.metadata[filePath];
  }

  const ext = getExtension(filePath);
  
  // 目前只支持 MP3 的 ID3 标签解析
  if (ext !== '.mp3') {
    return null;
  }

  try {
    // 读取文件头部和尾部（用于 ID3v1）
    const headBytes = await readFileHead(client, filePath, 256 * 1024);
    if (!headBytes) return null;

    // 解析 ID3v2（头部）
    const id3v2Data = parseID3v2(headBytes);

    // 尝试获取文件大小并读取尾部（ID3v1）
    let id3v1Data = null;
    try {
      const stat = await client.stat(filePath);
      if (stat.size > 128) {
        const axios = require("axios");
        const downloadLink = client.getFileDownloadLink(filePath);
        const response = await axios.get(downloadLink, {
          headers: {
            Range: `bytes=${stat.size - 128}-${stat.size - 1}`,
          },
          responseType: "arraybuffer",
          timeout: 5000,
        });
        const tailBytes = new Uint8Array(response.data);
        id3v1Data = parseID3v1(tailBytes);
      }
    } catch (e) {
      // 忽略尾部读取错误
    }

    // 合并元数据（ID3v2 优先级更高）
    const metadata = {
      title: id3v2Data.title || id3v1Data?.title || "",
      artist: id3v2Data.artist || id3v1Data?.artist || "",
      album: id3v2Data.album || id3v1Data?.album || "",
      year: id3v2Data.year || id3v1Data?.year || "",
      comment: id3v2Data.comment || id3v1Data?.comment || "",
      track: id3v2Data.track || id3v1Data?.track || "",
      genre: id3v2Data.genre || id3v1Data?.genre || "",
      hasCover: id3v2Data.hasCover || false,
      coverUrl: id3v2Data.hasCover ? client.getFileDownloadLink(filePath) : "",
    };

    // 缓存元数据
    cachedData.metadata[filePath] = metadata;
    
    return metadata;
  } catch (error) {
    console.error(`获取元数据失败 ${filePath}:`, error);
    return null;
  }
}

/**
 * 搜索音乐
 */
async function searchMusic(query) {
  const client = getClient();
  if (!client) {
    return { isEnd: true, data: [] };
  }

  const now = Date.now();
  const cacheExpired = now - cachedData.lastFetchTime > CACHE_TTL;

  // 如果缓存为空或已过期，重新获取文件列表
  if (
    !cachedData.cacheFileList ||
    cachedData.cacheFileList.length === 0 ||
    cacheExpired
  ) {
    const searchPaths =
      cachedData.searchPathList && cachedData.searchPathList.length > 0
        ? cachedData.searchPathList
        : ["/"];

    const filePromises = searchPaths.map((path) =>
      getAudioFilesFromDirectory(client, path, true),
    );

    try {
      const results = await Promise.allSettled(filePromises);
      cachedData.cacheFileList = results
        .filter((result) => result.status === "fulfilled")
        .flatMap((result) => result.value);
      cachedData.lastFetchTime = now;
    } catch (error) {
      console.error("获取音频文件列表失败:", error);
      cachedData.cacheFileList = [];
    }
  }

  // 如果没有查询关键词，返回所有文件
  if (!query || query.trim() === "") {
    return {
      isEnd: true,
      data: (cachedData.cacheFileList || []).map((file) => {
        const musicInfo = parseMusicInfo(file.basename || file.filename);
        return {
          id: file.filename,
          platform: "WebDAV",
          title: musicInfo.title,
          artist: musicInfo.artist,
          album: "",
          artwork: "",
          duration: 0,
          url: "",
        };
      }),
    };
  }

  // 根据关键词过滤
  const searchTerm = query.toLowerCase();
  const filteredFiles = (cachedData.cacheFileList || [])
    .filter((file) => {
      if (!file.basename) return false;
      return file.basename.toLowerCase().includes(searchTerm);
    })
    .map((file) => {
      const musicInfo = parseMusicInfo(file.basename);
      return {
        id: file.filename,
        platform: "WebDAV",
        title: musicInfo.title,
        artist: musicInfo.artist,
        album: "",
        artwork: "",
        duration: 0,
        url: "",
      };
    });

  return {
    isEnd: true,
    data: filteredFiles,
  };
}

/**
 * 获取歌单列表
 */
async function getTopLists() {
  getClient(); // 确保客户端初始化
  const searchPaths = cachedData.searchPathList || ["/"];

  return [
    {
      title: "全部歌曲",
      data: searchPaths.map((path) => ({
        title: path,
        id: path,
      })),
    },
  ];
}

/**
 * 获取歌单详情
 */
async function getTopListDetail(topListItem) {
  const client = getClient();
  if (!client || !topListItem || !topListItem.id) {
    return { musicList: [] };
  }

  try {
    const fileItems = await getAudioFilesFromDirectory(
      client,
      topListItem.id,
      false,
    );

    // 获取每个文件的元数据
    const musicList = [];
    for (const item of fileItems) {
      const musicInfo = parseMusicInfo(item.basename || item.filename);
      const metadata = await getAudioMetadata(client, item.filename);
      
      musicList.push({
        id: item.filename,
        platform: "WebDAV",
        title: metadata?.title || musicInfo.title,
        artist: metadata?.artist || musicInfo.artist,
        album: metadata?.album || "",
        artwork: metadata?.coverUrl || "",
        duration: 0,
        url: "",
      });
    }

    return { musicList };
  } catch (error) {
    console.error(`获取歌单详情失败 ${topListItem.id}:`, error);
    return { musicList: [] };
  }
}

/**
 * 获取音乐详情（包含元数据）
 */
async function getMusicInfo(musicItem) {
  const client = getClient();
  if (!client || !musicItem || !musicItem.id) {
    return musicItem;
  }

  try {
    const metadata = await getAudioMetadata(client, musicItem.id);
    if (!metadata) return musicItem;

    return {
      id: musicItem.id,
      platform: "WebDAV",
      title: metadata.title || musicItem.title,
      artist: metadata.artist || musicItem.artist,
      album: metadata.album || musicItem.album,
      artwork: metadata.coverUrl || musicItem.artwork,
      duration: musicItem.duration,
      url: musicItem.url,
    };
  } catch (error) {
    return musicItem;
  }
}

/**
 * 获取媒体源URL
 */
function getMediaSource(musicItem) {
  const client = getClient();
  if (!client || !musicItem || !musicItem.id) {
    return { url: null };
  }

  try {
    return {
      url: client.getFileDownloadLink(musicItem.id),
    };
  } catch (error) {
    console.error("获取媒体源URL失败:", error);
    return { url: null };
  }
}

/**
 * 获取歌词
 */
async function getLyric(musicItem) {
  if (!musicItem || !musicItem.id) {
    return { rawLrc: "" };
  }

  // 检查缓存
  let content = cachedData.lyric[musicItem.id];
  if (content) {
    return {
      rawLrc: content,
      translation: content,
    };
  }

  const client = getClient();
  if (!client) {
    return { rawLrc: "" };
  }

  // 将音频文件后缀换成 .lrc
  const lastDot = musicItem.id.lastIndexOf(".");
  const lrcPath = lastDot === -1 ? musicItem.id + ".lrc" : musicItem.id.substring(0, lastDot) + ".lrc";

  try {
    // 读取歌词文件内容
    const content = await client.getFileContents(lrcPath, {
      format: "text",
    });

    cachedData.lyric[musicItem.id] = content;
    return {
      rawLrc: content,
      translation: content,
    };
  } catch (error) {
    // 歌词文件不存在或其他错误
    return { rawLrc: "" };
  }
}

/**
 * 搜索函数（主入口）
 */
function search(query, page, type) {
  if (type === "music") {
    return searchMusic(query);
  }
  return Promise.resolve({ isEnd: true, data: [] });
}

/**
 * 导入歌单（文件夹作为歌单）
 */
async function importMusicSheet(urlLike) {
  const client = getClient();
  if (!client) {
    return { musicList: [] };
  }

  try {
    const folderPath = urlLike.startsWith("/") ? urlLike : "/" + urlLike;
    const fileItems = await getAudioFilesFromDirectory(client, folderPath, false);

    // 获取每个文件的元数据
    const musicList = [];
    for (const item of fileItems) {
      const musicInfo = parseMusicInfo(item.basename || item.filename);
      const metadata = await getAudioMetadata(client, item.filename);
      
      musicList.push({
        id: item.filename,
        platform: "WebDAV",
        title: metadata?.title || musicInfo.title,
        artist: metadata?.artist || musicInfo.artist,
        album: metadata?.album || "",
        artwork: metadata?.coverUrl || "",
        duration: 0,
        url: "",
      });
    }

    return { musicList };
  } catch (error) {
    console.error("WebDAV importMusicSheet error:", error);
    return { musicList: [] };
  }
}

/**
 * 获取专辑信息（文件夹作为专辑）
 */
async function getAlbumInfo(albumItem, page) {
  const client = getClient();
  if (!client || !albumItem || !albumItem.id) {
    return { isEnd: true, musicList: [] };
  }

  try {
    const fileItems = await getAudioFilesFromDirectory(client, albumItem.id, false);

    // 获取每个文件的元数据
    const musicList = [];
    for (const item of fileItems) {
      const musicInfo = parseMusicInfo(item.basename || item.filename);
      const metadata = await getAudioMetadata(client, item.filename);
      
      musicList.push({
        id: item.filename,
        platform: "WebDAV",
        title: metadata?.title || musicInfo.title,
        artist: metadata?.artist || musicInfo.artist,
        album: metadata?.album || albumItem.title || "",
        artwork: metadata?.coverUrl || albumItem.artwork || "",
        duration: 0,
        url: "",
      });
    }

    return { isEnd: true, musicList };
  } catch (error) {
    console.error("WebDAV getAlbumInfo error:", error);
    return { isEnd: true, musicList: [] };
  }
}

// 导出模块
module.exports = {
  platform: "WebDAV",
  version: "1.1.0",
  author: "异飨客",
  description: "连接 WebDAV 服务器播放音乐，支持读取音频内置标签",
  userVariables: [
    {
      key: "url",
      name: "WebDAV地址",
      hint: "例如: https://example.com/dav",
    },
    {
      key: "username",
      name: "用户名",
    },
    {
      key: "password",
      name: "密码",
      type: "password",
    },
    {
      key: "searchPath",
      name: "存放歌曲的路径",
      hint: "多个路径用逗号分隔，例如: /Music,/Audio",
    },
  ],
  srcUrl: "",
  cacheControl: "no-cache",

  // 提示文案
  hints: {
    importMusicSheet: [
      "1. 输入 WebDAV 服务器的文件夹路径作为歌单",
      "2. 格式: /music/playlist 或 music/playlist",
      "3. 支持自动读取 MP3 文件的 ID3 标签（标题、艺术家、专辑、封面等）",
      "4. 歌词文件需要与歌曲同名，后缀为 .lrc"
    ]
  },

  // 主功能接口
  search,
  getTopLists,
  getTopListDetail,
  getMusicInfo,
  getMediaSource,
  getLyric,
  importMusicSheet,
  getAlbumInfo,
};
