const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { ChzzkClient } = require('chzzk');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const chzzk = new ChzzkClient();
const CONFIG_PATH = path.join(__dirname, 'config.json');

// 방송 상태 및 채팅 소켓 저장 메모리
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

function pushConfigToGithub() {
  const commands = 'git add config.json && git commit -m "Auto-update config.json [skip ci]" && git push origin main';
  exec(commands, (error) => {
    if (error) console.log('[Config Sync Notice] GitHub 동기화 진행 중...');
    else console.log('[Config Sync Success] config.json이 GitHub에 정상 동기화되었습니다.');
  });
}

function saveConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
  pushConfigToGithub();
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

// 스크린샷 디자인과 동일한 링크 버튼 생성 함수
function createLinkButton(url) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('링크')
      .setURL(url)
      .setStyle(ButtonStyle.Link)
  );
}

// 스트리머 라이브 채팅 실시간 연결 및 감지
async function connectStreamerChat(channelId, discordChannel, streamerName) {
  if (activeChatSockets[channelId]) return;

  try {
    const chat = chzzk.chat({ channelId });
    activeChatSockets[channelId] = chat;

    chat.on('connect', () => {
      console.log(`[Chzzk Chat Connected] ${streamerName} 채팅 감지 시작`);
    });

    chat.on('chat', async (msg) => {
      // 스트리머 본인이 작성한 채팅만 골라냄 (채널 소유자 확인)
      if (msg.profile && msg.profile.isOwner) {
        const liveUrl = `https://chzzk.naver.com/live/${channelId}`;
        const profileImage = msg.profile.profileImageUrl || 'https://nng-phinf.pstatic.net/Chzzk_Logo.png';
        const chatMsg = msg.hidden ? '숨겨진 메시지입니다.' : msg.msg;

        // 스크린샷 예시와 100% 동일한 파란색 테두리 임베드 디자인 생성
        const embed = new EmbedBuilder()
          .setColor(0x4287f5) // 파란색 테두리
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

// 소켓 연결 해제
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
          // 1. 방송 시작 알림
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
          // 2. 방송 설정을 변경함 (방제/카테고리)
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
          // 3. 이미 방송 중인 경우 채팅 감지 연결 유지
          else if (isLive) {
            connectStreamerChat(channelId, discordChannel, streamerName);
          }
          // 4. 방송 종료 시 채팅 감지 해제
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