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

async function pushConfigToGithubAPI() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return;

  const owner = 'ABTshi123';
  const repo = 'discord-bot';
  const filePath = 'config.json';
  const content = fs.readFileSync(CONFIG_PATH, 'utf8');
  const base64Content = Buffer.from(content).toString('base64');

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

      const reqPut = https.request(optionsPut, (resPut) => {});
      reqPut.on('error', () => {});
      reqPut.write(postData);
      reqPut.end();
    });
  });

  reqGet.on('error', () => {});
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
  } catch (e) {}
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

// 라이브 채팅 실시간 연결 및 타 채널 감지 로직
async function connectStreamerChat(targetChannelId, hostStreamerName, client) {
  if (activeChatSockets[targetChannelId]) return;

  try {
    const chat = chzzk.chat({ channelId: targetChannelId });
    activeChatSockets[targetChannelId] = chat;

    chat.on('chat', async (msg) => {
      if (!msg.profile) return;

      const config = getConfig();
      if (!config.chzzk) return;

      const senderUserIdHash = msg.profile.userIdHash || msg.userIdHash;
      const chatMsg = msg.hidden ? '숨겨진 메시지입니다.' : msg.msg;
      const liveUrl = `https://chzzk.naver.com/live/${targetChannelId}`;
      const profileImage = msg.profile.profileImageUrl || 'https://nng-phinf.pstatic.net/Chzzk_Logo.png';

      // 1. 본인 방송 채널에서 방장이 채팅을 친 경우
      if (msg.profile.isOwner) {
        const myConfig = config.chzzk[targetChannelId];
        if (myConfig && myConfig.channelId) {
          const discordChannel = await client.channels.fetch(myConfig.channelId).catch(() => null);
          if (discordChannel) {
            const embed = new EmbedBuilder()
              .setColor(0x4287f5)
              .setAuthor({ name: hostStreamerName, iconURL: profileImage })
              .setTitle(`${hostStreamerName}님이 채팅을 남겼어요.`)
              .setDescription(chatMsg)
              .setTimestamp();

            await discordChannel.send({
              embeds: [embed],
              components: [createLinkButton(liveUrl)]
            }).catch(() => null);
          }
        }
      } 
      // 2. 다른 스트리머(등록된 대상들) 방송 채팅창에 출몰하여 메시지를 남긴 경우
      else {
        for (const streamerChannelId in config.chzzk) {
          // 채팅 작성자가 등록된 타 스트리머(자신의 채널이 아닌 곳에 출몰)일 때
          if (streamerChannelId !== targetChannelId && streamerChannelId === senderUserIdHash) {
            const registeredTarget = config.chzzk[streamerChannelId];
            if (!registeredTarget || !registeredTarget.channelId) continue;

            const discordChannel = await client.channels.fetch(registeredTarget.channelId).catch(() => null);
            if (discordChannel) {
              const visitorName = msg.profile.nickname || registeredTarget.name || '스트리머';

              // 스크린샷과 100% 동일한 양식으로 발송
              const embed = new EmbedBuilder()
                .setColor(0x4287f5)
                .setAuthor({ name: visitorName, iconURL: profileImage })
                .setTitle(`${visitorName}님이 ${hostStreamerName}님의 채팅창에 메시지를 남겼어요.`)
                .setDescription(chatMsg)
                .setTimestamp();

              await discordChannel.send({
                embeds: [embed],
                components: [createLinkButton(liveUrl)]
              }).catch(() => null);
            }
          }
        }
      }
    });

    await chat.connect();
  } catch (e) {
    console.error(`[Chzzk Chat Error] ${targetChannelId}:`, e.message);
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
            connectStreamerChat(channelId, streamerName, client);
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
            connectStreamerChat(channelId, streamerName, client);
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