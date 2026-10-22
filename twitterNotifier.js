const Parser = require('rss-parser');
const parser = new Parser();
const { EmbedBuilder } = require('discord.js');
const { getConfig } = require('./chzzkNotifier');

// 마지막으로 확인한 트윗 ID 저장용
const lastTweetMap = new Map();

/**
 * 무료 RSS 피드를 통해 최신 트윗 감지
 */
async function checkLatestTweet(username, discordChannel) {
  try {
    const rssUrl = `https://nitter.net/${username}/rss`;
    const feed = await parser.parseURL(rssUrl);

    if (!feed.items || feed.items.length === 0) return;

    const latestTweet = feed.items[0];
    const tweetId = latestTweet.guid || latestTweet.link;

    // 이미 알림을 보낸 트윗이면 건너뜀
    if (lastTweetMap.get(username) === tweetId) return;

    // 처음 켜졌을 때는 기준점만 잡고 메시지 전송은 중복 방지를 위해 패스
    if (!lastTweetMap.has(username)) {
      lastTweetMap.set(username, tweetId);
      return;
    }

    lastTweetMap.set(username, tweetId);

    // 파란색 트위터 스타일 임베드 카드 생성
    const embed = new EmbedBuilder()
      .setColor('#1DA1F2')
      .setAuthor({ name: `@${username} 님의 새로운 트윗`, iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png' })
      .setTitle(latestTweet.title ? latestTweet.title.substring(0, 256) : '새 트윗이 등록되었습니다.')
      .setURL(latestTweet.link)
      .setDescription(latestTweet.contentSnippet || latestTweet.content || '내용 없음')
      .setTimestamp(new Date(latestTweet.pubDate))
      .setFooter({ text: 'Twitter (X) 알림' });

    await discordChannel.send({ embeds: [embed] });
  } catch (error) {
    // Nitter 서버 접속 불가 시 에러로 봇이 꺼지지 않도록 처리
    console.log(`[Twitter Monitor Notice] @${username} 트윗 조회 중...`);
  }
}

/**
 * 등록된 트위터 목록을 3분마다 순회 감지
 */
async function startTwitterMonitoring(client) {
  setInterval(async () => {
    const config = getConfig();
    if (!config.twitter) return;

    for (const twitterId in config.twitter) {
      const target = config.twitter[twitterId];
      if (!target.channelId) continue;

      try {
        const discordChannel = await client.channels.fetch(target.channelId).catch(() => null);
        if (discordChannel) {
          await checkLatestTweet(twitterId, discordChannel);
        }
      } catch (err) {
        console.error(`[Twitter Monitor Error] @${twitterId}:`, err.message);
      }
    }
  }, 180000); // 3분 간격
}

module.exports = { checkLatestTweet, startTwitterMonitoring };