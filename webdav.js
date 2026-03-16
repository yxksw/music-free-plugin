const { createWebdavClient } = require("webdav");
const path = require("path");

// 支持的音频文件扩展名
const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma', '.ape', '.opus'];

// 从文件名解析歌曲信息
function parseMusicInfo(filename) {
    const ext = path.extname(filename).toLowerCase();
    if (!AUDIO_EXTENSIONS.includes(ext)) {
        return null;
    }

    const basename = path.basename(filename, ext);

    // 尝试匹配 "艺术家 - 标题" 格式
    const match = basename.match(/^(.+?)\s*[-–—]\s*(.+)$/);
    if (match) {
        return {
            title: match[2].trim(),
            artist: match[1].trim(),
        };
    }

    // 默认使用文件名作为标题
    return {
        title: basename.trim(),
        artist: "未知艺术家",
    };
}

// 创建WebDAV客户端
function createClient(config) {
    const clientConfig = {
        username: config.username || "",
        password: config.password || "",
    };

    // 如果提供了自定义headers
    if (config.headers) {
        clientConfig.headers = config.headers;
    }

    return createWebdavClient(config.url, clientConfig);
}

// 文件项转换为MusicItem
function fileToMusicItem(file, platform, baseUrl, basePath) {
    const info = parseMusicInfo(file.basename);
    if (!info) {
        return null;
    }

    // 构建文件的唯一ID（相对于basePath的路径）
    const relativePath = file.filename.startsWith(basePath)
        ? file.filename.substring(basePath.length)
        : file.filename;

    return {
        id: relativePath || file.basename,
        platform: platform,
        title: info.title,
        artist: info.artist,
        album: "",
        artwork: "",
        duration: 0, // WebDAV无法直接获取音频时长，需要额外解析
        url: "", // 在getMediaSource中返回真实URL
        // 存储原始文件信息供后续使用
        _webdavPath: file.filename,
        _webdavUrl: `${baseUrl}${file.filename}`,
    };
}

// 递归获取目录下的所有音频文件
function getAllAudioFiles(client, dirPath, platform, baseUrl, basePath) {
    const results = [];

    return client.getDirectoryContents(dirPath).then(function(items) {
        // 处理每个项目
        const promises = items.map(function(item) {
            if (item.type === "directory") {
                // 递归获取子目录
                return getAllAudioFiles(
                    client,
                    item.filename,
                    platform,
                    baseUrl,
                    basePath
                ).then(function(subFiles) {
                    results.push.apply(results, subFiles);
                });
            } else if (item.type === "file") {
                const musicItem = fileToMusicItem(item, platform, baseUrl, basePath);
                if (musicItem) {
                    results.push(musicItem);
                }
            }
            return Promise.resolve();
        });

        return Promise.all(promises);
    }).then(function() {
        return results;
    }).catch(function(error) {
        console.error("Error reading directory " + dirPath + ":", error);
        return results;
    });
}

module.exports = {
    platform: "WebDAV音源",
    version: "1.0.1",
    author: "MusicFree Plugin",
    description: "播放WebDAV服务器上的音乐文件",
    srcUrl: "https://cdn.jsdmirror.com/gh/yxksw/music-free-plugin@main/webdav.js",
    cacheControl: "no-cache",

    // 支持的搜索类型
    supportedSearchType: ["music"],

    // 用户配置项
    userConfigs: [
        {
            key: "url",
            label: "WebDAV服务器地址",
            type: "string",
            defaultValue: "",
        },
        {
            key: "username",
            label: "用户名",
            type: "string",
            defaultValue: "",
        },
        {
            key: "password",
            label: "密码",
            type: "password",
            defaultValue: "",
        },
        {
            key: "basePath",
            label: "基础路径",
            type: "string",
            defaultValue: "/",
        },
    ],

    // 提示文案
    hints: {
        importMusicSheet: [
            "1. 输入WebDAV目录路径，例如: /music/我的歌单",
            "2. 插件会递归扫描目录下的所有音频文件",
            "3. 支持的格式: mp3, flac, wav, aac, ogg, m4a, wma, ape, opus",
            "4. 文件名格式建议: 艺术家 - 标题.mp3",
        ],
    },

    // 初始化函数
    init: function(config) {
        // 存储用户配置
        this._config = config;
    },

    // 获取配置
    getConfig: function() {
        const config = this._config || {};
        return {
            url: config.url || "",
            username: config.username || "",
            password: config.password || "",
            basePath: config.basePath || "/",
        };
    },

    // 搜索功能 - 在WebDAV中搜索文件
    search: function(query, page, type) {
        if (type !== "music") {
            return Promise.resolve({ isEnd: true, data: [] });
        }

        const config = this.getConfig();
        if (!config.url) {
            return Promise.resolve({ isEnd: true, data: [] });
        }

        const self = this;
        return new Promise(function(resolve) {
            getAllAudioFiles(
                createClient(config),
                config.basePath,
                self.platform,
                config.url,
                config.basePath
            ).then(function(allFiles) {
                // 过滤匹配搜索关键词的文件
                const keyword = query.toLowerCase();
                const filtered = allFiles.filter(function(item) {
                    return item.title.toLowerCase().includes(keyword) ||
                           item.artist.toLowerCase().includes(keyword);
                });

                // 分页
                const pageSize = 20;
                const start = (page - 1) * pageSize;
                const end = start + pageSize;
                const pageData = filtered.slice(start, end);

                resolve({
                    isEnd: end >= filtered.length,
                    data: pageData,
                });
            }).catch(function(error) {
                console.error("Search error:", error);
                resolve({ isEnd: true, data: [] });
            });
        });
    },

    // 获取音乐的真实播放URL
    getMediaSource: function(musicItem, quality) {
        if (!musicItem._webdavUrl) {
            return Promise.resolve(null);
        }

        // 返回WebDAV文件的直接访问URL
        return Promise.resolve({
            url: musicItem._webdavUrl,
        });
    },

    // 获取音乐详情
    getMusicInfo: function(musicItem) {
        return Promise.resolve(musicItem);
    },

    // 获取歌词 - 尝试查找同名的.lrc文件
    getLyric: function(musicItem) {
        if (!musicItem._webdavPath) {
            return Promise.resolve(null);
        }

        const config = this.getConfig();
        const client = createClient(config);
        const lrcPath = musicItem._webdavPath.replace(
            path.extname(musicItem._webdavPath),
            ".lrc"
        );

        return client.getFileContents(lrcPath, {
            format: "text",
        }).then(function(lrcContent) {
            if (lrcContent) {
                return { rawLrc: lrcContent };
            }
            return null;
        }).catch(function() {
            // 歌词文件不存在或读取失败
            return null;
        });
    },

    // 导入歌单 - 将WebDAV目录作为歌单导入
    importMusicSheet: function(urlLike) {
        const config = this.getConfig();
        if (!config.url) {
            return Promise.reject(new Error("WebDAV未配置，请先在插件设置中配置WebDAV服务器地址"));
        }

        // 解析输入的路径
        let targetPath = urlLike.trim();
        if (!targetPath.startsWith("/")) {
            targetPath = "/" + targetPath;
        }

        const self = this;
        const client = createClient(config);

        return client.stat(targetPath).then(function(stat) {
            if (stat.type !== "directory") {
                throw new Error("路径不是目录");
            }

            // 获取目录名作为歌单名
            const sheetName = path.basename(targetPath) || "WebDAV歌单";

            // 获取目录下的所有音频文件
            return getAllAudioFiles(
                client,
                targetPath,
                self.platform,
                config.url,
                targetPath
            ).then(function(musicList) {
                if (musicList.length === 0) {
                    throw new Error("目录中没有找到音频文件");
                }

                return {
                    id: targetPath,
                    platform: self.platform,
                    title: sheetName,
                    artist: "",
                    artwork: "",
                    description: "WebDAV目录: " + targetPath,
                    musicList: musicList,
                };
            });
        }).catch(function(error) {
            console.error("Import sheet error:", error);
            throw error;
        });
    },

    // 获取歌单详情
    getMusicSheetInfo: function(sheetItem, page) {
        if (sheetItem.musicList) {
            const pageSize = 30;
            const start = (page - 1) * pageSize;
            const end = start + pageSize;
            const pageData = sheetItem.musicList.slice(start, end);

            return Promise.resolve({
                isEnd: end >= sheetItem.musicList.length,
                musicList: pageData,
                description: sheetItem.description,
            });
        }
        return Promise.resolve({ isEnd: true, musicList: [] });
    },
};
