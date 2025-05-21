// 改进返回功能
function goBack(e) {
    if (e) e.preventDefault();
    
    // 1. 首先检查是否从搜索页面进入的播放器 (优先使用localStorage中的记录)
    const cameFromSearch = localStorage.getItem('cameFromSearch') === 'true';
    const searchPageUrl = localStorage.getItem('searchPageUrl');
    
    if (cameFromSearch && searchPageUrl) {
        console.log('返回搜索页面:', searchPageUrl);
        window.location.href = searchPageUrl;
        // 清除标记，避免下次返回仍然去搜索页
        localStorage.removeItem('cameFromSearch');
        return;
    }
    
    // 继续原有的返回逻辑...
    const referrer = document.referrer;
    
    // 检查referrer是否包含搜索参数
    if (referrer && (referrer.includes('?s=') || referrer.includes('/s='))) {
        // 如果是从搜索页面来的，返回到搜索页面
        console.log('根据referrer返回搜索页面:', referrer);
        window.location.href = referrer;
        return;
    }
    
    // 2. 尝试从URL参数获取返回地址
    const urlParams = new URLSearchParams(window.location.search);
    const returnUrl = urlParams.get('returnUrl');
    
    if (returnUrl) {
        // 存在明确的返回地址
        console.log('使用returnUrl参数返回:', decodeURIComponent(returnUrl)); // decodeURIComponent added
        window.location.href = decodeURIComponent(returnUrl); // decodeURIComponent added
        return;
    }
    
    // 3. 如果是在iframe中打开的，尝试关闭iframe
    if (closeEmbeddedPlayer()) {
        console.log('关闭了嵌入式播放器');
        return;
    }
    
    // 4. 其次尝试从localStorage中获取上一页URL
    const lastPageUrl = localStorage.getItem('lastPageUrl');
    if (lastPageUrl && lastPageUrl !== window.location.href) {
        console.log('从localStorage返回:', lastPageUrl);
        window.location.href = lastPageUrl;
        return;
    }
    
    // 5. 检查referrer是否是有效的站内页面
    if (referrer && 
        referrer !== window.location.href && 
        (referrer.includes(window.location.hostname) || referrer.startsWith('/'))) {
        console.log('返回referrer页面:', referrer);
        window.location.href = referrer;
        return;
    }
    
    // 6. 都不满足时，返回首页
    console.log('返回首页');
    window.location.href = '/';
}

// 页面加载时保存当前URL到localStorage，作为返回目标
window.addEventListener('load', function() {
    // 保存前一页面URL
    if (document.referrer && document.referrer !== window.location.href) {
        localStorage.setItem('lastPageUrl', document.referrer);
    }
    
    // 提取当前URL中的重要参数，以便在需要时能够恢复当前页面
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('id');
    const sourceCode = urlParams.get('source');
    
    if (videoId && sourceCode) {
        // 保存当前播放状态，以便其他页面可以返回
        localStorage.setItem('currentPlayingId', videoId);
        localStorage.setItem('currentPlayingSource', sourceCode);
    }
});


// =================================
// ============== PLAYER ==========
// =================================
// 全局变量
let currentVideoTitle = '';
let currentEpisodeIndex = 0;
let currentEpisodes = [];
let episodesReversed = false;
let dp = null;
let currentHls = null; // 跟踪当前HLS实例
let autoplayEnabled = true; // 默认开启自动连播
let isUserSeeking = false; // 跟踪用户是否正在拖动进度条
let videoHasEnded = false; // 跟踪视频是否已经自然结束
let userClickedPosition = null; // 记录用户点击的位置
let shortcutHintTimeout = null; // 用于控制快捷键提示显示时间
let adFilteringEnabled = true; // 默认开启广告过滤
let progressSaveInterval = null; // 定期保存进度的计时器
let currentVideoUrl = ''; // 记录当前实际的视频URL

// 页面加载
document.addEventListener('DOMContentLoaded', function() {
    // 先检查用户是否已通过密码验证
    if (!isPasswordVerified()) {
        // 隐藏加载提示
        document.getElementById('loading').style.display = 'none';
        return;
    }

    initializePageContent();
});

// 监听密码验证成功事件
document.addEventListener('passwordVerified', () => {
    document.getElementById('loading').style.display = 'block';

    initializePageContent();
});

// 初始化页面内容
function initializePageContent() {
    // 解析URL参数
    const urlParams = new URLSearchParams(window.location.search);
    let videoUrl = urlParams.get('url');
    const title = urlParams.get('title');
    const sourceCode = urlParams.get('source_code');
    let index = parseInt(urlParams.get('index') || '0');
    const episodesList = urlParams.get('episodes'); // 从URL获取集数信息
    const savedPosition = parseInt(urlParams.get('position') || '0'); // 获取保存的播放位置
      // 解决历史记录问题：检查URL是否是player.html开头的链接
    // 如果是，说明这是历史记录重定向，需要解析真实的视频URL
    if (videoUrl && videoUrl.includes('player.html')) {
        console.log('检测到历史记录重定向URL:', videoUrl);
        try {
            // 尝试从嵌套URL中提取真实的视频链接
            const nestedUrlParams = new URLSearchParams(videoUrl.split('?')[1]);
            // 从嵌套参数中获取真实视频URL
            const nestedVideoUrl = nestedUrlParams.get('url');
            // 检查嵌套URL是否包含播放位置信息
            const nestedPosition = nestedUrlParams.get('position');
            const nestedIndex = nestedUrlParams.get('index');
            const nestedTitle = nestedUrlParams.get('title');
            
            if (nestedVideoUrl) {
                videoUrl = nestedVideoUrl;
                console.log('已修正为真实视频URL:', videoUrl);
                
                // 更新当前URL参数
                const url = new URL(window.location.href);
                if (!urlParams.has('position') && nestedPosition) {
                    url.searchParams.set('position', nestedPosition);
                }
                if (!urlParams.has('index') && nestedIndex) {
                    url.searchParams.set('index', nestedIndex);
                }
                if (!urlParams.has('title') && nestedTitle) {
                    url.searchParams.set('title', nestedTitle);
                }
                // 替换当前URL
                window.history.replaceState({}, '', url);
                console.log('从嵌套URL提取参数:', {position: nestedPosition, index: nestedIndex});
            } else {
                console.warn('无法从重定向URL中提取视频链接');
                showError('历史记录链接无效，请返回首页重新访问');
            }
        } catch (e) {
            console.error('解析嵌套URL出错:', e);
        }
    }
    
    // 保存当前视频URL
    currentVideoUrl = videoUrl || '';

    // 从localStorage获取数据
    currentVideoTitle = title || localStorage.getItem('currentVideoTitle') || '未知视频';
    currentEpisodeIndex = index;
    
    // 设置自动连播开关状态
    autoplayEnabled = localStorage.getItem('autoplayEnabled') !== 'false'; // 默认为true
    document.getElementById('autoplayToggle').checked = autoplayEnabled;
    
    // 获取广告过滤设置
    adFilteringEnabled = localStorage.getItem(PLAYER_CONFIG.adFilteringStorage) !== 'false'; // 默认为true
    
    // 监听自动连播开关变化
    document.getElementById('autoplayToggle').addEventListener('change', function(e) {
        autoplayEnabled = e.target.checked;
        localStorage.setItem('autoplayEnabled', autoplayEnabled);
    });
    
    // 优先使用URL传递的集数信息，否则从localStorage获取
    try {
        if (episodesList) {
            // 如果URL中有集数数据，优先使用它
            currentEpisodes = JSON.parse(decodeURIComponent(episodesList));
            console.log('从URL恢复集数信息:', currentEpisodes.length);
        } else {
            // 否则从localStorage获取
            currentEpisodes = JSON.parse(localStorage.getItem('currentEpisodes') || '[]');
            console.log('从localStorage恢复集数信息:', currentEpisodes.length);
        }
        
        // 检查集数索引是否有效，如果无效则调整为0
        if (index < 0 || (currentEpisodes.length > 0 && index >= currentEpisodes.length)) {
            console.warn(`无效的剧集索引 ${index}，调整为范围内的值`);
            
            // 如果索引太大，则使用最大有效索引
            if (index >= currentEpisodes.length && currentEpisodes.length > 0) {
                index = currentEpisodes.length - 1;
            } else {
                index = 0;
            }
            
            // 更新URL以反映修正后的索引
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.set('index', index);
            window.history.replaceState({}, '', newUrl);
        }
        
        // 更新当前索引为验证过的值
        currentEpisodeIndex = index;
        
        episodesReversed = localStorage.getItem('episodesReversed') === 'true';
    } catch (e) {
        console.error('获取集数信息失败:', e);
        currentEpisodes = [];
        currentEpisodeIndex = 0;
        episodesReversed = false;
    }

    // 设置页面标题
    document.title = currentVideoTitle + ' - LibreTV播放器';
    document.getElementById('videoTitle').textContent = currentVideoTitle;

    // 初始化播放器
    if (videoUrl) {
        initPlayer(videoUrl, sourceCode);
    } else {
        showError('无效的视频链接');
    }

    // 更新集数信息
    updateEpisodeInfo();
    
    // 渲染集数列表
    renderEpisodes();
    
    // 更新按钮状态
    updateButtonStates();
    
    // 更新排序按钮状态
    updateOrderButton();

    // 添加对进度条的监听，确保点击准确跳转
    setTimeout(() => {
        setupProgressBarPreciseClicks();
    }, 1000);

    // 添加键盘快捷键事件监听
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // 添加页面离开事件监听，保存播放位置
    window.addEventListener('beforeunload', saveCurrentProgress);

    // 新增：页面隐藏（切后台/切标签）时也保存
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') {
            saveCurrentProgress();
        }
    });

    // 新增：视频暂停时也保存
    // 需确保 dp.video 已初始化
    const waitForVideo = setInterval(() => {
        if (dp && dp.video) {
            dp.video.addEventListener('pause', saveCurrentProgress);

            // 新增：播放进度变化时节流保存
            let lastSave = 0;
            dp.video.addEventListener('timeupdate', function() {
                const now = Date.now();
                if (now - lastSave > 5000) { // 每5秒最多保存一次
                    saveCurrentProgress();
                    lastSave = now;
                }
            });

            clearInterval(waitForVideo);
        }
    }, 200);
}

// 处理键盘快捷键
function handleKeyboardShortcuts(e) {
    // 忽略输入框中的按键事件
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // Alt + 左箭头 = 上一集
    if (e.altKey && e.key === 'ArrowLeft') {
        if (currentEpisodeIndex > 0) {
            playPreviousEpisode();
            showShortcutHint('上一集', 'left');
            e.preventDefault();
        }
    }
    
    // Alt + 右箭头 = 下一集
    if (e.altKey && e.key === 'ArrowRight') {
        if (currentEpisodeIndex < currentEpisodes.length - 1) {
            playNextEpisode();
            showShortcutHint('下一集', 'right');
            e.preventDefault();
        }
    }
}

// 显示快捷键提示
function showShortcutHint(text, direction) {
    const hintElement = document.getElementById('shortcutHint');
    const textElement = document.getElementById('shortcutText');
    const iconElement = document.getElementById('shortcutIcon');
    
    // 清除之前的超时
    if (shortcutHintTimeout) {
        clearTimeout(shortcutHintTimeout);
    }
    
    // 设置文本和图标方向
    textElement.textContent = text;
    
    if (direction === 'left') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>';
    } else {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>';
    }
    
    // 显示提示
    hintElement.classList.add('show');
    
    // 两秒后隐藏
    shortcutHintTimeout = setTimeout(() => {
        hintElement.classList.remove('show');
    }, 2000);
}

// 初始化播放器
function initPlayer(videoUrl, sourceCode) {
    if (!videoUrl) return;

    // 配置HLS.js选项
    const hlsConfig = {
        debug: false,
        loader: adFilteringEnabled ? CustomHlsJsLoader : Hls.DefaultConfig.loader,
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 30 * 1000 * 1000,
        maxBufferHole: 0.5,
        fragLoadingMaxRetry: 6,
        fragLoadingMaxRetryTimeout: 64000,
        fragLoadingRetryDelay: 1000,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 4,
        levelLoadingRetryDelay: 1000,
        startLevel: -1,
        abrEwmaDefaultEstimate: 500000,
        abrBandWidthFactor: 0.95,
        abrBandWidthUpFactor: 0.7,
        abrMaxWithRealBitrate: true,
        stretchShortVideoTrack: true,
        appendErrorMaxRetry: 5,  // 增加尝试次数
        liveSyncDurationCount: 3,
        liveDurationInfinity: false
    };
    
    // 创建DPlayer实例
    dp = new DPlayer({
        container: document.getElementById('player'),
        autoplay: true,
        theme: '#00ccff',
        preload: 'auto',
        loop: false,
        lang: 'zh-cn',
        hotkey: true,        // 启用键盘控制，包括空格暂停/播放、方向键控制进度和音量
        mutex: true,
        volume: 0.7,
        screenshot: true,                // 启用截图功能
        preventClickToggle: false,       // 允许点击视频切换播放/暂停
        airplay: true,                   // 在Safari中启用AirPlay功能
        chromecast: true,                // 启用Chromecast投屏功能
        contextmenu: [                   // 自定义右键菜单
            {
                text: '关于 LibreTV',
                link: 'https://github.com/LibreSpark/LibreTV'
            },
            {
                text: '问题反馈',
                click: (player) => {
                    window.open('https://github.com/LibreSpark/LibreTV/issues', '_blank');
                }
            }
        ],
        video: {
            url: videoUrl,
            type: 'hls',
            pic: 'image/nomedia.png', // 设置视频封面图
            customType: {
                hls: function(video, player) {
                    // 清理之前的HLS实例
                    if (currentHls && currentHls.destroy) {
                        try {
                            currentHls.destroy();
                        } catch (e) {
                            console.warn('销毁旧HLS实例出错:', e);
                        }
                    }
                    
                    // 创建新的HLS实例
                    const hls = new Hls(hlsConfig);
                    currentHls = hls;
                    
                    // 跟踪是否已经显示错误
                    let errorDisplayed = false;
                    // 跟踪是否有错误发生
                    let errorCount = 0;
                    // 跟踪视频是否开始播放
                    let playbackStarted = false;
                    // 跟踪视频是否出现bufferAppendError
                    let bufferAppendErrorCount = 0;
                    
                    // 监听视频播放事件
                    video.addEventListener('playing', function() {
                        playbackStarted = true;
                        document.getElementById('loading').style.display = 'none';
                        document.getElementById('error').style.display = 'none';
                    });
                    
                    // 监听视频进度事件
                    video.addEventListener('timeupdate', function() {
                        if (video.currentTime > 1) {
                            // 视频进度超过1秒，隐藏错误（如果存在）
                            document.getElementById('error').style.display = 'none';
                        }
                    });

                    hls.loadSource(video.src);
                    hls.attachMedia(video);
                    
                    // enable airplay, from https://github.com/video-dev/hls.js/issues/5989
                    // 检查是否已存在source元素，如果存在则更新，不存在则创建
                    let sourceElement = video.querySelector('source');
                    if (sourceElement) {
                        // 更新现有source元素的URL
                        sourceElement.src = videoUrl;
                    } else {
                        // 创建新的source元素
                        sourceElement = document.createElement('source');
                        sourceElement.src = videoUrl;
                        video.appendChild(sourceElement);
                    }
                    video.disableRemotePlayback = false;
                    
                    hls.on(Hls.Events.MANIFEST_PARSED, function() {
                        video.play().catch(e => {
                            console.warn('自动播放被阻止:', e);
                        });
                    });
                    
                    hls.on(Hls.Events.ERROR, function(event, data) {
                        console.log('HLS事件:', event, '数据:', data);
                        
                        // 增加错误计数
                        errorCount++;
                        
                        // 处理bufferAppendError
                        if (data.details === 'bufferAppendError') {
                            bufferAppendErrorCount++;
                            console.warn(`bufferAppendError 发生 ${bufferAppendErrorCount} 次`);
                            
                            // 如果视频已经开始播放，则忽略这个错误
                            if (playbackStarted) {
                                console.log('视频已在播放中，忽略bufferAppendError');
                                return;
                            }
                            
                            // 如果出现多次bufferAppendError但视频未播放，尝试恢复
                            if (bufferAppendErrorCount >= 3) {
                                hls.recoverMediaError();
                            }
                        }
                        
                        // 如果是致命错误，且视频未播放
                        if (data.fatal && !playbackStarted) {
                            console.error('致命HLS错误:', data);
                            
                            // 尝试恢复错误
                            switch(data.type) {
                                case Hls.ErrorTypes.NETWORK_ERROR:
                                    console.log("尝试恢复网络错误");
                                    hls.startLoad();
                                    break;
                                case Hls.ErrorTypes.MEDIA_ERROR:
                                    console.log("尝试恢复媒体错误");
                                    hls.recoverMediaError();
                                    break;
                                default:
                                    // 仅在多次恢复尝试后显示错误
                                    if (errorCount > 3 && !errorDisplayed) {
                                        errorDisplayed = true;
                                        showError('视频加载失败，可能是格式不兼容或源不可用');
                                    }
                                    break;
                            }
                        }
                    });
                    
                    // 监听分段加载事件
                    hls.on(Hls.Events.FRAG_LOADED, function() {
                        document.getElementById('loading').style.display = 'none';
                    });
                    
                    // 监听级别加载事件
                    hls.on(Hls.Events.LEVEL_LOADED, function() {
                        document.getElementById('loading').style.display = 'none';
                    });
                }
            }
    }
    });
    // 全屏模式下锁定横屏
    dp.on('fullscreen', () => {
        if (window.screen.orientation && window.screen.orientation.lock) {
            window.screen.orientation.lock('landscape')
            .then(() => {
                console.log('屏幕已锁定为横向模式');
            })
            .catch((error) => {
                console.warn('无法锁定屏幕方向，请手动旋转设备:', error);
            });
        } else {
            console.warn('当前浏览器不支持锁定屏幕方向，请手动旋转设备。');
        }
    });
      // 全屏取消时解锁屏幕方向
    dp.on('fullscreen_cancel', () => {
        if (window.screen.orientation && window.screen.orientation.unlock) {
            window.screen.orientation.unlock();
        }
    });
    
    dp.on('loadedmetadata', function() {
        document.getElementById('loading').style.display = 'none';
        videoHasEnded = false; // 视频加载时重置结束标志

        // 优先使用URL传递的position参数
        const urlParams = new URLSearchParams(window.location.search);
        const savedPosition = parseInt(urlParams.get('position') || '0');
        
        if (savedPosition > 10 && dp && dp.video && dp.video.duration > 0 && savedPosition < dp.video.duration - 2) {
            // 如果URL中有有效的播放位置参数，直接使用它
            dp.seek(savedPosition);
            showPositionRestoreHint(savedPosition);
        } else {
            // 否则尝试从本地存储恢复播放进度
            try {
                const progressKey = 'videoProgress_' + currentVideoUrl; // Use currentVideoUrl for unique key
                const progressStr = localStorage.getItem(progressKey);
                if (progressStr && dp && dp.video && dp.video.duration > 0) {
                    const progress = JSON.parse(progressStr);
                    if (
                        progress &&
                        typeof progress.position === 'number' &&
                        progress.position > 10 &&
                        progress.position < dp.video.duration - 2
                    ) {
                        dp.seek(progress.position);
                        showPositionRestoreHint(progress.position);
                    }
                }
            } catch (e) {
                // ignore
            }
        }

        // 视频加载成功后重新设置进度条点击监听
        setupProgressBarPreciseClicks();
        
        // 视频加载成功后，在稍微延迟后将其添加到观看历史
        setTimeout(saveToHistory, 3000);
        
        // 启动定期保存播放进度
        startProgressSaveInterval();
    });

    dp.on('error', function() {
        // 如果正在切换视频，忽略错误
        if (window.isSwitchingVideo) {
            console.log('正在切换视频，忽略错误');
            return;
        }
        
        // 检查视频是否已经在播放
        if (dp.video && dp.video.currentTime > 1) {
            console.log('发生错误，但视频已在播放中，忽略');
            return;
        }
        showError('视频播放失败，请检查视频源或网络连接');
    });

    // 添加移动端长按两倍速播放功能
    setupLongPressSpeedControl();
    
    // 添加seeking和seeked事件监听器，以检测用户是否在拖动进度条
    dp.on('seeking', function() {
        isUserSeeking = true;
        videoHasEnded = false; // 重置视频结束标志
        
        // 如果是用户通过点击进度条设置的位置，确保准确跳转
        if (userClickedPosition !== null && dp.video) {
            // 确保用户的点击位置被正确应用，避免自动跳至视频末尾
            const clickedTime = userClickedPosition;
            
            // 防止跳转到视频结尾
            if (Math.abs(dp.video.duration - clickedTime) < 0.5) {
                // 如果点击的位置非常接近结尾，稍微减少一点时间
                dp.video.currentTime = Math.max(0, clickedTime - 0.5);
            } else {
                dp.video.currentTime = clickedTime;
            }
            
            // 清除记录的位置
            setTimeout(() => {
                userClickedPosition = null;
            }, 200);
        }
    });
    
    // 改进seeked事件处理
    dp.on('seeked', function() {
        // 如果视频跳转到了非常接近结尾的位置(小于0.3秒)，且不是自然播放到此处
        if (dp.video && dp.video.duration > 0) {
            const timeFromEnd = dp.video.duration - dp.video.currentTime;
            if (timeFromEnd < 0.3 && isUserSeeking) {
                // 将播放时间往回移动一点点，避免触发结束事件
                dp.video.currentTime = Math.max(0, dp.video.currentTime - 1);
            }
        }
        
        // 延迟重置seeking标志，以便于区分自然播放结束和用户拖拽
        setTimeout(() => {
            isUserSeeking = false;
        }, 200);
    });
    
    // 修改视频结束事件监听器，添加额外检查
    dp.on('ended', function() {
        videoHasEnded = true; // 标记视频已自然结束
        
        // 视频已播放完，清除播放进度记录
        clearVideoProgress();
        
        // 如果启用了自动连播，并且有下一集可播放，则自动播放下一集
        if (autoplayEnabled && currentEpisodeIndex < currentEpisodes.length - 1) {
            console.log('视频播放结束，自动播放下一集');
            // 稍长延迟以确保所有事件处理完成
            setTimeout(() => {
                // 确认不是因为用户拖拽导致的假结束事件
                if (videoHasEnded && !isUserSeeking) {
                    playNextEpisode();
                    videoHasEnded = false; // 重置标志
                }
            }, 1000);
        } else {
            console.log('视频播放结束，无下一集或未启用自动连播');
        }
    });
    
    // 添加事件监听以检测近视频末尾的点击拖动
    dp.on('timeupdate', function() {
        if (dp.video && dp.duration > 0) {
            // 如果视频接近结尾但不是自然播放到结尾，重置自然结束标志
            if (isUserSeeking && dp.video.currentTime > dp.video.duration * 0.95) {
                videoHasEnded = false;
            }
        }
    });

    // 添加双击全屏支持
    dp.on('playing', () => {
        // 绑定双击事件到视频容器
        dp.video.addEventListener('dblclick', () => {
            dp.fullScreen.toggle();
        });
    });

    // 10秒后如果仍在加载，但不立即显示错误
    setTimeout(function() {
        // 如果视频已经播放开始，则不显示错误
        if (dp && dp.video && dp.video.currentTime > 0) {
            return;
        }
        
        if (document.getElementById('loading').style.display !== 'none') {
            document.getElementById('loading').innerHTML = `
                <div class="loading-spinner"></div>
                <div>视频加载时间较长，请耐心等待...</div>
                <div style="font-size: 12px; color: #aaa; margin-top: 10px;">如长时间无响应，请尝试其他视频源</div>
            `;
        }
    }, 10000);

    // 绑定原生全屏：DPlayer 触发全屏时调用 requestFullscreen
    (function(){
        const fsContainer = document.getElementById('playerContainer');
        dp.on('fullscreen', () => {
            if (fsContainer.requestFullscreen) {
                fsContainer.requestFullscreen().catch(err => console.warn('原生全屏失败:', err));
            }
        });
        dp.on('fullscreen_cancel', () => {
            if (document.fullscreenElement) {
                document.exitFullscreen();
            }
        });
    })();
}

// 自定义M3U8 Loader用于过滤广告
class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
    constructor(config) {
        super(config);
        const load = this.load.bind(this);
        this.load = function(context, config, callbacks) {
            // 拦截manifest和level请求
            if (context.type === 'manifest' || context.type === 'level') {
                const onSuccess = callbacks.onSuccess;
                callbacks.onSuccess = function(response, stats, context) {
                    // 如果是m3u8文件，处理内容以移除广告分段
                    if (response.data && typeof response.data === 'string') {
                        // 过滤掉广告段 - 实现更精确的广告过滤逻辑
                        response.data = filterAdsFromM3U8(response.data, true);
                    }
                    return onSuccess(response, stats, context);
                };
            }
            // 执行原始load方法
            load(context, config, callbacks);
        };
    }
}

// M3U8清单广告过滤函数
function filterAdsFromM3U8(m3u8Content, strictMode = false) {
    if (!m3u8Content) return '';

    // 按行分割M3U8内容
    const lines = m3u8Content.split('\n');
    const filteredLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 只过滤#EXT-X-DISCONTINUITY标识
        if (!line.includes('#EXT-X-DISCONTINUITY')) {
            filteredLines.push(line);
        }
    }

    return filteredLines.join('\n');
}


// 显示错误
function showError(message) {
    // 在视频已经播放的情况下不显示错误
    if (dp && dp.video && dp.video.currentTime > 1) {
        console.log('忽略错误:', message);
        return;
    }
    
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'flex';
    document.getElementById('error-message').textContent = message;
}

// 更新集数信息
function updateEpisodeInfo() {
    if (currentEpisodes.length > 0) {
        document.getElementById('episodeInfo').textContent = `第 ${currentEpisodeIndex + 1}/${currentEpisodes.length} 集`;
    } else {
        document.getElementById('episodeInfo').textContent = '无集数信息';
    }
}

// 更新按钮状态
function updateButtonStates() {
    const prevButton = document.getElementById('prevButton');
    const nextButton = document.getElementById('nextButton');
    
    // 处理上一集按钮
    if (currentEpisodeIndex > 0) {
        prevButton.classList.remove('bg-gray-700', 'cursor-not-allowed');
        prevButton.classList.add('bg-[#222]', 'hover:bg-[#333]');
        prevButton.removeAttribute('disabled');
    } else {
        prevButton.classList.add('bg-gray-700', 'cursor-not-allowed');
        prevButton.classList.remove('bg-[#222]', 'hover:bg-[#333]');
        prevButton.setAttribute('disabled', '');
    }
    
    // 处理下一集按钮
    if (currentEpisodeIndex < currentEpisodes.length - 1) {
        nextButton.classList.remove('bg-gray-700', 'cursor-not-allowed');
        nextButton.classList.add('bg-[#222]', 'hover:bg-[#333]');
        nextButton.removeAttribute('disabled');
    } else {
        nextButton.classList.add('bg-gray-700', 'cursor-not-allowed');
        nextButton.classList.remove('bg-[#222]', 'hover:bg-[#333]');
        nextButton.setAttribute('disabled', '');
    }
}

// 渲染集数按钮
function renderEpisodes() {
    const episodesList = document.getElementById('episodesList');
    if (!episodesList) return;
    
    if (!currentEpisodes || currentEpisodes.length === 0) {
        episodesList.innerHTML = '<div class="col-span-full text-center text-gray-400 py-8">没有可用的集数</div>';
        return;
    }
    
    const episodes = episodesReversed ? [...currentEpisodes].reverse() : currentEpisodes;
    let html = '';
    
    episodes.forEach((episode, index) => {
        // 根据倒序状态计算真实的剧集索引
        const realIndex = episodesReversed ? currentEpisodes.length - 1 - index : index;
        const isActive = realIndex === currentEpisodeIndex;
        
        html += `
            <button id="episode-${realIndex}" 
                    onclick="playEpisode(${realIndex})" 
                    class="px-4 py-2 ${isActive ? 'episode-active' : '!bg-[#222] hover:!bg-[#333] hover:!shadow-none'} !border ${isActive ? '!border-blue-500' : '!border-[#333]'} rounded-lg transition-colors text-center episode-btn">
                第${realIndex + 1}集
            </button>
        `;
    });
    
    episodesList.innerHTML = html;
}

// 播放指定集数
function playEpisode(index) {
    // 确保index在有效范围内
    if (index < 0 || index >= currentEpisodes.length) {
        console.error(`无效的剧集索引: ${index}, 当前剧集数量: ${currentEpisodes.length}`);
        showToast(`无效的剧集索引: ${index + 1}，当前剧集总数: ${currentEpisodes.length}`);
        return;
    }
    
    // 保存当前播放进度（如果正在播放）
    if (dp && dp.video && !dp.video.paused && !videoHasEnded) {
        saveCurrentProgress();
    }
    
    // 清除进度保存计时器
    if (progressSaveInterval) {
        clearInterval(progressSaveInterval);
        progressSaveInterval = null;
    }
    
    // 首先隐藏之前可能显示的错误
    document.getElementById('error').style.display = 'none';
    // 显示加载指示器
    document.getElementById('loading').style.display = 'flex';
    document.getElementById('loading').innerHTML = `
        <div class="loading-spinner"></div>
        <div>正在加载视频...</div>
    `;
    
    const url = currentEpisodes[index];
    // 更新全局URL记录
    currentVideoUrl = url;
    currentEpisodeIndex = index;
    videoHasEnded = false; // 重置视频结束标志
    
    // 新增：清除之前的播放位置记录，确保切换选集后从头开始播放
    clearVideoProgress();
    
    // 获取当前URL的所有参数
    const currentUrl = new URL(window.location.href);
    const urlParams = currentUrl.searchParams;
    const sourceName = urlParams.get('source') || ''; 
    const sourceCode = urlParams.get('source_code') || '';
    const videoId = urlParams.get('id') || '';
    const returnUrl = urlParams.get('returnUrl') || '';
    
    // 构建新的URL，保持查询参数但更新index和url
    const newUrl = new URL(window.location.origin + window.location.pathname);
    // 保留所有原始参数
    for(const [key, value] of urlParams.entries()) {
        newUrl.searchParams.set(key, value);
    }
    // 更新需要变更的参数
    newUrl.searchParams.set('index', index);
    newUrl.searchParams.set('url', url);
    // 移除position参数，确保不会从记录的位置开始播放
    newUrl.searchParams.delete('position');
    
    // 使用replaceState更新URL，这样不会增加浏览历史记录
    window.history.replaceState({}, '', newUrl);
    
    // 更新播放器
    if (dp) {
        try {
            // 检测是否为Safari浏览器或iOS设备
            const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
            
            if (isSafari || isIOS) {
                // Safari或iOS设备：完全重新初始化播放器
                console.log('检测到Safari或iOS设备，重新初始化播放器');

                // 标记正在切换视频，避免错误处理
                window.isSwitchingVideo = true;
                
                // 如果存在旧的播放器实例，先销毁它
                if (dp && dp.destroy) {
                    try {
                        dp.destroy();
                    } catch (e) {
                        console.warn('销毁旧播放器实例出错:', e);
                    }
                }
                
                // 重新初始化播放器
                initPlayer(url, sourceCode);

                // 延迟重置标记
                setTimeout(() => {
                    window.isSwitchingVideo = false;
                }, 1000);
            } else {
                // 其他浏览器使用正常的switchVideo方法
                if (dp.video) {
                    // 更新source元素
                    const sources = dp.video.querySelectorAll('source');
                    sources.forEach(source => source.src = url);
                }
                
                dp.switchVideo({
                    url: url,
                    type: 'hls'
                });
            }
            
            // 确保播放开始
            if (dp) {
                const playPromise = dp.play();
                if (playPromise !== undefined) {
                    playPromise.catch(error => {
                        console.warn('播放失败，尝试重新初始化:', error);
                        // 如果切换视频失败，重新初始化播放器
                        initPlayer(url, sourceCode);
                    });
                }
            }
        } catch (e) {
            console.error('切换视频出错，尝试重新初始化:', e);
            // 如果出错，重新初始化播放器
            initPlayer(url, sourceCode);
        }
    } else {
        initPlayer(url, sourceCode);
    }
    
    // 更新UI
    updateEpisodeInfo();
    updateButtonStates();
    renderEpisodes();

    // 重置用户点击位置记录
    userClickedPosition = null;
    
    // 三秒后保存到历史记录
    setTimeout(() => saveToHistory(), 3000);
}

// 播放上一集
function playPreviousEpisode() {
    if (currentEpisodeIndex > 0) {
        playEpisode(currentEpisodeIndex - 1);
    }
}

// 播放下一集
function playNextEpisode() {
    if (currentEpisodeIndex < currentEpisodes.length - 1) {
        playEpisode(currentEpisodeIndex + 1);
    }
}

// 复制播放链接
function copyLinks() {
    // 尝试从URL中获取参数
    const urlParams = new URLSearchParams(window.location.search);
    const linkUrl = urlParams.get('url') || '';
    if (linkUrl !== '') {
        navigator.clipboard.writeText(linkUrl).then(() => {
            showToast('播放链接已复制', 'success');
        }).catch(err => {
            showToast('复制失败，请检查浏览器权限', 'error');
        });
    }
}

// 切换集数排序
function toggleEpisodeOrder() {
    episodesReversed = !episodesReversed;
    
    // 保存到localStorage
    localStorage.setItem('episodesReversed', episodesReversed);
    
    // 重新渲染集数列表
    renderEpisodes();
    
    // 更新排序按钮
    updateOrderButton();
}

// 更新排序按钮状态
function updateOrderButton() {
    const orderText = document.getElementById('orderText');
    const orderIcon = document.getElementById('orderIcon');
    
    if (orderText && orderIcon) {
        orderText.textContent = episodesReversed ? '正序排列' : '倒序排列';
        orderIcon.style.transform = episodesReversed ? 'rotate(180deg)' : '';
    }
}

// 设置进度条准确点击处理
function setupProgressBarPreciseClicks() {
    // 查找DPlayer的进度条元素
    const progressBar = document.querySelector('.dplayer-bar-wrap');
    if (!progressBar || !dp || !dp.video) return;
    
    // 移除可能存在的旧事件监听器
    progressBar.removeEventListener('mousedown', handleProgressBarClick);
    
    // 添加新的事件监听器
    progressBar.addEventListener('mousedown', handleProgressBarClick);
    
    // 在移动端也添加触摸事件支持
    progressBar.removeEventListener('touchstart', handleProgressBarTouch);
    progressBar.addEventListener('touchstart', handleProgressBarTouch);
    
    console.log('进度条精确点击监听器已设置');
}

// 处理进度条点击
function handleProgressBarClick(e) {
    if (!dp || !dp.video) return;
    
    // 计算点击位置相对于进度条的比例
    const rect = e.currentTarget.getBoundingClientRect();
    const percentage = (e.clientX - rect.left) / rect.width;
    
    // 计算点击位置对应的视频时间
    const duration = dp.video.duration;
    let clickTime = percentage * duration;
    
    // 处理视频接近结尾的情况
    if (duration - clickTime < 1) {
        // 如果点击位置非常接近结尾，稍微往前移一点
        clickTime = Math.min(clickTime, duration - 1.5);
        console.log(`进度条点击接近结尾，调整时间为 ${clickTime.toFixed(2)}/${duration.toFixed(2)}`);
    }
    
    // 记录用户点击的位置
    userClickedPosition = clickTime;
    
    // 输出调试信息
    console.log(`进度条点击: ${percentage.toFixed(4)}, 时间: ${clickTime.toFixed(2)}/${duration.toFixed(2)}`);
    
    // 阻止默认事件传播，避免DPlayer内部逻辑将视频跳至末尾
    e.stopPropagation();
    
    // 直接设置视频时间
    dp.seek(clickTime);
}

// 处理移动端触摸事件
function handleProgressBarTouch(e) {
    if (!dp || !dp.video || !e.touches[0]) return;
    
    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    const percentage = (touch.clientX - rect.left) / rect.width;
    
    const duration = dp.video.duration;
    let clickTime = percentage * duration;
    
    // 处理视频接近结尾的情况
    if (duration - clickTime < 1) {
        clickTime = Math.min(clickTime, duration - 1.5);
    }
    
    // 记录用户点击的位置
    userClickedPosition = clickTime;
    
    console.log(`进度条触摸: ${percentage.toFixed(4)}, 时间: ${clickTime.toFixed(2)}/${duration.toFixed(2)}`);
    
    e.stopPropagation();
    dp.seek(clickTime);
}

// 在播放器初始化后添加视频到历史记录
function saveToHistory() {
    // 确保 currentEpisodes 非空且有当前视频URL
    if (!currentEpisodes || currentEpisodes.length === 0 || !currentVideoUrl) {
        console.warn('没有可用的剧集列表或视频URL，无法保存完整的历史记录');
        return;
    }
    
    // 尝试从URL中获取参数
    const urlParams = new URLSearchParams(window.location.search);
    const sourceName = urlParams.get('source') || '';
    const sourceCode = urlParams.get('source_code') || '';

    // 获取当前播放进度
    let currentPosition = 0;
    let videoDuration = 0;
    
    if (dp && dp.video) {
        currentPosition = dp.video.currentTime;
        videoDuration = dp.video.duration;
    }

    // 构建要保存的视频信息对象
    const videoInfo = {
        title: currentVideoTitle,
        // 直接保存原始视频链接，而非播放页面链接
        directVideoUrl: currentVideoUrl,
        // 完整的播放器URL
        url: `player.html?url=${encodeURIComponent(currentVideoUrl)}&title=${encodeURIComponent(currentVideoTitle)}&source=${encodeURIComponent(sourceName)}&source_code=${encodeURIComponent(sourceCode)}&index=${currentEpisodeIndex}&position=${Math.floor(currentPosition || 0)}`,
        episodeIndex: currentEpisodeIndex,
        sourceName: sourceName,
        timestamp: Date.now(),
        // 添加播放进度信息
        playbackPosition: currentPosition,
        duration: videoDuration,
        // 重要：保存完整的集数列表，确保进行深拷贝
        episodes: currentEpisodes && currentEpisodes.length > 0 ? [...currentEpisodes] : []
    };
    
    try {
        // 获取现有历史记录
        const history = JSON.parse(localStorage.getItem('viewingHistory') || '[]');
        
        // 检查是否已经存在相同标题的记录（同一视频的不同集数）
        const existingIndex = history.findIndex(item => item.title === videoInfo.title);
        if (existingIndex !== -1) {
            // 存在则更新现有记录的集数、时间戳和URL
            history[existingIndex].episodeIndex = currentEpisodeIndex;
            history[existingIndex].timestamp = Date.now();
            history[existingIndex].sourceName = sourceName;
            // 更新原始视频URL
            history[existingIndex].directVideoUrl = currentVideoUrl;
            // 更新播放进度信息
            history[existingIndex].playbackPosition = currentPosition > 10 ? currentPosition : history[existingIndex].playbackPosition;
            history[existingIndex].duration = videoDuration || history[existingIndex].duration;
            // 更新完整URL，确保带有正确的视频链接
            history[existingIndex].url = videoInfo.url;
            // 更新集数列表（如果有且与当前不同）
            if (currentEpisodes && currentEpisodes.length > 0) {
                // 检查是否需要更新集数数据（针对不同长度的集数列表）
                if (!history[existingIndex].episodes || 
                    !Array.isArray(history[existingIndex].episodes) || 
                    history[existingIndex].episodes.length !== currentEpisodes.length) {
                    history[existingIndex].episodes = [...currentEpisodes]; // 深拷贝
                    console.log(`更新 "${currentVideoTitle}" 的剧集数据: ${currentEpisodes.length}集`);
                }
            }
            
            // 移到最前面
            const updatedItem = history.splice(existingIndex, 1)[0];
            history.unshift(updatedItem);
        } else {
            // 添加新记录到最前面
            console.log(`创建新的历史记录: "${currentVideoTitle}", ${currentEpisodes.length}集`);
            history.unshift(videoInfo);
        }
        
        // 限制历史记录数量为50条
        if (history.length > 50) history.splice(50);
        
        localStorage.setItem('viewingHistory', JSON.stringify(history));
        console.log('成功保存历史记录');
    } catch (e) {
        console.error('保存观看历史失败:', e);
    }
}

// 显示恢复位置提示
function showPositionRestoreHint(position) {
    if (!position || position < 10) return;
    
    // 创建提示元素
    const hint = document.createElement('div');
    hint.className = 'position-restore-hint';
    hint.innerHTML = `
        <div class="hint-content">
            已从 ${formatTime(position)} 继续播放
        </div>
    `;
    
    // 添加到播放器容器
    const playerContainer = document.querySelector('.player-container'); // Ensure this selector is correct
    if (playerContainer) { // Check if playerContainer exists
        playerContainer.appendChild(hint);
    } else {
        console.warn("Player container not found for position hint.");
        return; // Exit if container not found
    }
    
    // 显示提示
    setTimeout(() => {
        hint.classList.add('show');
        
        // 3秒后隐藏
        setTimeout(() => {
            hint.classList.remove('show');
            setTimeout(() => hint.remove(), 300);
        }, 3000);
    }, 100);
}

// 格式化时间为 mm:ss 格式
function formatTime(seconds) {
    if (isNaN(seconds)) return '00:00';
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// 开始定期保存播放进度
function startProgressSaveInterval() {
    // 清除可能存在的旧计时器
    if (progressSaveInterval) {
        clearInterval(progressSaveInterval);
    }
    
    // 每30秒保存一次播放进度
    progressSaveInterval = setInterval(saveCurrentProgress, 30000);
}

// 保存当前播放进度
function saveCurrentProgress() {
    if (!dp || !dp.video) return;
    const currentTime = dp.video.currentTime;
    const duration = dp.video.duration;
    if (!duration || currentTime < 1) return;

    // 在localStorage中保存进度
    const progressKey = `videoProgress_${getVideoId()}`;
    const progressData = {
        position: currentTime,
        duration: duration,
        timestamp: Date.now()
    };
    try {
        localStorage.setItem(progressKey, JSON.stringify(progressData));
        // --- 新增：同步更新 viewingHistory 中的进度 ---
        try {
            const historyRaw = localStorage.getItem('viewingHistory');
            if (historyRaw) {
                const history = JSON.parse(historyRaw);
                // 用 title + 集数索引唯一标识
                const idx = history.findIndex(item =>
                    item.title === currentVideoTitle &&
                    (item.episodeIndex === undefined || item.episodeIndex === currentEpisodeIndex)
                );
                if (idx !== -1) {
                    // 只在进度有明显变化时才更新，减少写入
                    if (
                        Math.abs((history[idx].playbackPosition || 0) - currentTime) > 2 ||
                        Math.abs((history[idx].duration || 0) - duration) > 2
                    ) {
                        history[idx].playbackPosition = currentTime;
                        history[idx].duration = duration;
                        history[idx].timestamp = Date.now();
                        localStorage.setItem('viewingHistory', JSON.stringify(history));
                    }
                }
            }
        } catch (e) {
            // 忽略 viewingHistory 更新错误
        }
    } catch (e) {
        console.error('保存播放进度失败', e);
    }
}

// 设置移动端长按两倍速播放功能
function setupLongPressSpeedControl() {
    if (!dp || !dp.video) return;
    
    const playerElement = document.getElementById('player');
    let longPressTimer = null;
    let originalPlaybackRate = 1.0;
    let isLongPress = false;
    
    // 显示快速提示
    function showSpeedHint(speed) {
        showShortcutHint(`${speed}倍速`, 'right');
    }

    // 禁用右键
    playerElement.oncontextmenu =  () => {
        // 检测是否为移动设备
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        // 只在移动设备上禁用右键
        if (isMobile) {
            const dplayerMenu = document.querySelector(".dplayer-menu");
            const dplayerMask = document.querySelector(".dplayer-mask");
            if (dplayerMenu) dplayerMenu.style.display = "none";
            if (dplayerMask) dplayerMask.style.display = "none";
            return false;
        }
        return true; // 在桌面设备上允许右键菜单
    };
    
    // 触摸开始事件
    playerElement.addEventListener('touchstart', function(e) {
        // 检查视频是否正在播放，如果没有播放则不触发长按功能
        if (dp.video.paused) {
            return; // 视频暂停时不触发长按功能
        }
        
        // 保存原始播放速度
        originalPlaybackRate = dp.video.playbackRate;
        
        // 设置长按计时器
        longPressTimer = setTimeout(() => {
            // 再次检查视频是否仍在播放
            if (dp.video.paused) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
                return;
            }
            
            // 长按超过500ms，设置为3倍速
            dp.video.playbackRate = 3.0;
            isLongPress = true;
            showSpeedHint(3.0);
            
            // 只在确认为长按时阻止默认行为
            e.preventDefault();
        }, 500);
    }, { passive: false });
    
    // 触摸结束事件
    playerElement.addEventListener('touchend', function(e) {
        // 清除长按计时器
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        
        // 如果是长按状态，恢复原始播放速度
        if (isLongPress) {
            dp.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
            showSpeedHint(originalPlaybackRate);
            
            // 阻止长按后的点击事件
            e.preventDefault();
        }
        // 如果不是长按，则允许正常的点击事件（暂停/播放）
    });
    
    // 触摸取消事件
    playerElement.addEventListener('touchcancel', function() {
        // 清除长按计时器
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        
        // 如果是长按状态，恢复原始播放速度
        if (isLongPress) {
            dp.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
        }
    });
    
    // 触摸移动事件 - 防止在长按时触发页面滚动
    playerElement.addEventListener('touchmove', function(e) {
        if (isLongPress) {
            e.preventDefault();
        }
    }, { passive: false });
    
    // 视频暂停时取消长按状态
    dp.video.addEventListener('pause', function() {
        if (isLongPress) {
            dp.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
        }
        
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });
}

// 清除视频进度记录
function clearVideoProgress() {
    const progressKey = `videoProgress_${getVideoId()}`;
    try {
        localStorage.removeItem(progressKey);
        console.log('已清除播放进度记录');
    } catch (e) {
        console.error('清除播放进度记录失败', e);
    }
}

// 获取视频唯一标识
function getVideoId() {
    // 使用视频标题和集数索引作为唯一标识
    // If currentVideoUrl is available and more unique, prefer it. Otherwise, fallback.
    if (currentVideoUrl) {
         return `${encodeURIComponent(currentVideoUrl)}`;
    }
    return `${encodeURIComponent(currentVideoTitle)}_${currentEpisodeIndex}`;
}

let controlsLocked = false;
function toggleControlsLock() {
    const container = document.getElementById('playerContainer');
    controlsLocked = !controlsLocked;
    container.classList.toggle('controls-locked', controlsLocked);
    const icon = document.getElementById('lockIcon');
    // 切换图标：锁 / 解锁
    icon.innerHTML = controlsLocked
        ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d=\"M12 15v2m0-8V7a4 4 0 00-8 0v2m8 0H4v8h16v-8H6v-6z\"/>'
        : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d=\"M15 11V7a3 3 0 00-6 0v4m-3 4h12v6H6v-6z\"/>';
}

// 支持在iframe中关闭播放器
function closeEmbeddedPlayer() {
    try {
        if (window.self !== window.top) {
            // 如果在iframe中，尝试调用父窗口的关闭方法
            if (window.parent && typeof window.parent.closeVideoPlayer === 'function') {
                window.parent.closeVideoPlayer();
                return true;
            }
        }
    } catch (e) {
        console.error('尝试关闭嵌入式播放器失败:', e);
    }
    return false;
}
