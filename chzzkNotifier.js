const fs = require('fs');
const path = require('path');
const https = require('https');
const { ChzzkClient } = require('chzzk');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const chzzk = new ChzzkClient();
const CONFIG_PATH = path.join(__dirname, 'config.json');

const lastLiveStatus = {};
const activeChatSockets = {};

function getConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

// GitHub REST API를 이용해 config.json 원격 저장소 백업
async function pushConfigToGithubAPI() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log('[Config Sync Warning] GITHUB_TOKEN이 .env에 등록되어 있지 않습니다.');
    return;
  }

  const owner = 'ABTshi123';
  const repo = 'discord-bot';
  const filePath = 'config.json';
  const content = fs.readFileSync(CONFIG_PATH, 'utf8');
  const base64Content = Buffer.from(content).toString('base64');

  // 1. 기존 파일의 SHA 값 가져오기
  const optionsGet = {
    hostname: 'api.github.com',
    path: `/repos/${owner}/${repo}/contents/${filePath}`,
    method: 'GET',
    headers: {
      'User-Agent': 'Discord-Bot',
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  };

  const reqGet = https.request(optionsGet, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      let sha = null;
      try {
        const json = JSON.parse(body);
        if (json.sha) sha = json.sha;
      } catch (e) {}

      // 2. GitHub API로 파일 덮어쓰기 (Update File)
      const postData = JSON.stringify({
        message: 'Auto-update config.json via GitHub API [skip ci]',
        content: base64Content,
        sha: sha || undefined
      });

      const optionsPut = {
        hostname: 'api.github.com',
        path: `/repos/${owner}/${repo}/contents/${filePath}`,
        method: 'PUT',
        headers: {
          'User-Agent': 'Discord-Bot',
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        }
      };

      const reqPut = https.request(optionsPut, (resPut) => {
        if (resPut.statusCode === 200 || resPut.statusCode === 201) {
          console.log('[Config Sync Success] GitHub API로 config.json 백업 완료!');
        } else {
          console.log(`[Config Sync Error] API 응답 코드: ${resPut.statusCode}`);
        }
      });

      reqPut.on('error', (e) => console.error('[Config Sync Request Error]:', e.message));
      reqPut.write(postData);
      reqPut.end();
    });
  });

  reqGet.on('error', (e) => console.error('[Config Sync SHA Fetch Error]:', e.message));
  reqGet.end();
}

function saveConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
  pushConfigToGithubAPI();
}

async function fetchLiveDetail(channelId) {
  try {
    if (typeof chzzk.live?.detail === 'function') return await chzzk.live.detail(channelId);
    if (typeof chzzk.live?.get === 'function') return await chzzk.live.get(channelId);
    if (typeof chzzk.channel?.getLiveDetail === 'function') return await chzzk.channel.getLiveDetail(channelId);
  } catch (e) {
    console.error(`[Chzzk Fetch Error] ${channelId}:`, e.message);
  }
  return null;
}

function createLinkButton(url) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('링크')
      .setURL(url)
      .setStyle(ButtonStyle.Link)
  );
}

async function connectStreamerChat(channelId, discordChannel, streamerName) {
  if (activeChatSockets[channelId]) return;

  try {
    const chat = chzzk.chat({ channelId });
    activeChatSockets[channelId] = chat;

    chat.on('chat', async (msg) => {
      if (msg.profile && msg.profile.isOwner) {
        const liveUrl = `https://chzzk.naver.com/live/${channelId}`;
        const profileImage = msg.profile.profileImageUrl || 'https://nng-phinf.pstatic.net/Chzzk_Logo.png';
        const chatMsg = msg.hidden ? '숨겨진 메시지입니다.' : msg.msg;

        const embed = new EmbedBuilder()
          .setColor(0x4287f5)
          .setAuthor({ name: streamerName, iconURL: profileImage })
          .setTitle(`${streamerName}님이 채팅을 남겼어요.`)
          .setDescription(chatMsg)
          .setTimestamp();

        await discordChannel.send({
          embeds: [embed],
          components: [createLinkButton(liveUrl)]
        }).catch(() => null);
      }
    });

    await chat.connect();
  } catch (e) {
    console.error(`[Chzzk Chat Error] ${channelId}:`, e.message);
  }
}

function disconnectStreamerChat(channelId) {
  if (activeChatSockets[channelId]) {
    try {
      activeChatSockets[channelId].disconnect();
    } catch (e) {}
    delete activeChatSockets[channelId];
  }
}

async function startChzzkMonitoring(client) {
  setInterval(async () => {
    const config = getConfig();
    if (!config.chzzk) return;

    for (const channelId in config.chzzk) {
      const target = config.chzzk[channelId];
      if (!target.channelId) continue;

      try {
        const liveDetail = await fetchLiveDetail(channelId);
        if (!liveDetail) continue;

        const isLive = liveDetail.status === 'OPEN';
        const wasLive = lastLiveStatus[channelId]?.isLive || false;
        const prevTitle = lastLiveStatus[channelId]?.title;
        const prevCategory = lastLiveStatus[channelId]?.category;

        const liveTitle = liveDetail.liveTitle || '제목 없음';
        const streamerName = target.name || liveDetail.channel?.channelName || '스트리머';
        const category = liveDetail.liveCategoryValue || '카테고리 없음';
        const liveUrl = `https://chzzk.naver.com/live/${channelId}`;
        const profileImageUrl = liveDetail.channel?.channelImageUrl || 'https://nng-phinf.pstatic.net/Chzzk_Logo.png';

        const discordChannel = await client.channels.fetch(target.channelId).catch(() => null);

        if (discordChannel) {
          if (isLive && !wasLive) {
            const embed = new EmbedBuilder()
              .setColor(0x4287f5)
              .setAuthor({ name: streamerName, iconURL: profileImageUrl })
              .setTitle(`${streamerName}님이 치지직 방송을 시작했어요!!`)
              .setDescription(`**[${liveTitle}]**\n\n방송 카테고리: ${category}`)
              .setFooter({ text: 'Chzzk' })
              .setTimestamp();

            await discordChannel.send({
              embeds: [embed],
              components: [createLinkButton(liveUrl)]
            });
            connectStreamerChat(channelId, discordChannel, streamerName);
          }
          else if (isLive && wasLive && (prevTitle !== liveTitle || prevCategory !== category)) {
            const embed = new EmbedBuilder()
              .setColor(0x4287f5)
              .setAuthor({ name: streamerName, iconURL: profileImageUrl })
              .setTitle(`${streamerName}님이 치지직 방송 설정을 변경하셨어요!`)
              .setDescription(`**제목: [${liveTitle}]**`)
              .setFooter({ text: 'Chzzk' })
              .setTimestamp();

            await discordChannel.send({
              embeds: [embed],
              components: [createLinkButton(liveUrl)]
            });
          }
          else if (isLive) {
            connectStreamerChat(channelId, discordChannel, streamerName);
          }
          else if (!isLive && wasLive) {
            disconnectStreamerChat(channelId);
          }
        }

        lastLiveStatus[channelId] = { isLive, title: liveTitle, category };

      } catch (err) {
        console.error(`[Chzzk Monitor Error] ${channelId}:`, err.message);
      }
    }
  }, 60000);
}

module.exports = { startChzzkMonitoring, getConfig, saveConfig };