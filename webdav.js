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
async function getAllAudioFiles(client, dirPath, platform, baseUrl, basePath) {
    const results = [];

    try {
        const items = await client.getDirectoryContents(dirPath);

        for (const item of items) {
            if (item.type === "directory") {
                // 递归获取子目录
                const subFiles = await getAllAudioFiles(
                    client,
                    item.filename,
                    platform,
                    baseUrl,
                    basePath
                );
                results.push(...subFiles);
            } else if (item.type === "file") {
                const musicItem = fileToMusicItem(item, platform, baseUrl, basePath);
                if (musicItem) {
                    results.push(musicItem);
                }
            }
        }
    } catch (error) {
        console.error("Error reading directory " + dirPath + ":", error);
    }

    return results;
}

module.exports = {
    platform: "WebDAV",
    version: "1.0.0",
    author: "MusicFree Plugin",
    description: "播放WebDAV服务器上的音乐文件",
    srcUrl: "",
    cacheControl: "no-cache",

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
    async init(config) {
        // 存储用户配置
        this._config = config;
    },

    // 获取配置
    getConfig() {
        return {
            url: this._config?.url || "",
            username: this._config?.username || "",
            password: this._config?.password || "",
            basePath: this._config?.basePath || "/",
        };
    },

    // 搜索功能 - 在WebDAV中搜索文件
    async search(query, page, type) {
        if (type !== "music") {
            return { isEnd: true, data: [] };
        }

        const config = this.getConfig();
        if (!config.url) {
            return { isEnd: true, data: [] };
        }

        try {
            const client = createClient(config);
            const allFiles = await getAllAudioFiles(
                client,
                config.basePath,
                this.platform,
                config.url,
                config.basePath
            );

            // 过滤匹配搜索关键词的文件
            const keyword = query.toLowerCase();
            const filtered = allFiles.filter(
                function(item) {
                    return item.title.toLowerCase().includes(keyword) ||
                           item.artist.toLowerCase().includes(keyword);
                }
            );

            // 分页
            const pageSize = 20;
            const start = (page - 1) * pageSize;
            const end = start + pageSize;
            const pageData = filtered.slice(start, end);

            return {
                isEnd: end >= filtered.length,
                data: pageData,
            };
        } catch (error) {
            console.error("Search error:", error);
            return { isEnd: true, data: [] };
        }
    },

    // 获取音乐的真实播放URL
    async getMediaSource(musicItem, quality) {
        if (!musicItem._webdavUrl) {
            return null;
        }

        // 返回WebDAV文件的直接访问URL
        return {
            url: musicItem._webdavUrl,
        };
    },

    // 获取音乐详情
    async getMusicInfo(musicItem) {
        return musicItem;
    },

    // 获取歌词 - 尝试查找同名的.lrc文件
    async getLyric(musicItem) {
        if (musicItem._webdavPath) {
            try {
                const config = this.getConfig();
                const client = createClient(config);
                const lrcPath = musicItem._webdavPath.replace(
                    path.extname(musicItem._webdavPath),
                    ".lrc"
                );

                const lrcContent = await client.getFileContents(lrcPath, {
                    format: "text",
                });

                if (lrcContent) {
                    return { rawLrc: lrcContent };
                }
            } catch (error) {
                // 歌词文件不存在或读取失败
            }
        }
        return null;
    },

    // 导入歌单 - 将WebDAV目录作为歌单导入
    async importMusicSheet(urlLike) {
        const config = this.getConfig();
        if (!config.url) {
            throw new Error("WebDAV未配置，请先在插件设置中配置WebDAV服务器地址");
        }

        // 解析输入的路径
        let targetPath = urlLike.trim();
        if (!targetPath.startsWith("/")) {
            targetPath = "/" + targetPath;
        }

        try {
            const client = createClient(config);

            // 检查路径是否存在
            const stat = await client.stat(targetPath);
            if (stat.type !== "directory") {
                throw new Error("路径不是目录");
            }

            // 获取目录名作为歌单名
            const sheetName = path.basename(targetPath) || "WebDAV歌单";

            // 获取目录下的所有音频文件
            const musicList = await getAllAudioFiles(
                client,
                targetPath,
                this.platform,
                config.url,
                targetPath
            );

            if (musicList.length === 0) {
                throw new Error("目录中没有找到音频文件");
            }

            return {
                id: targetPath,
                platform: this.platform,
                title: sheetName,
                artist: "",
                artwork: "",
                description: "WebDAV目录: " + targetPath,
                musicList: musicList,
            };
        } catch (error) {
            console.error("Import sheet error:", error);
            throw error;
        }
    },

    // 获取歌单详情
    async getMusicSheetInfo(sheetItem, page) {
        if (sheetItem.musicList) {
            const pageSize = 30;
            const start = (page - 1) * pageSize;
            const end = start + pageSize;
            const pageData = sheetItem.musicList.slice(start, end);

            return {
                isEnd: end >= sheetItem.musicList.length,
                musicList: pageData,
                description: sheetItem.description,
            };
        }
        return { isEnd: true, musicList: [] };
    },
};
