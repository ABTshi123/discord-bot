const Parser = require('rss-parser');
const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
});
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getConfig } = require('./chzzkNotifier');

const lastTweetMap = new Map();

// 사용할 작동 가능한 Nitter / RSS 브릿지 서버 목록 (다중 백업)
const NITTER_INSTANCES = [
  'https://nitter.poast.org',
  'https://nitter.cz',
  'https://nitter.privacydev.net'
];

async function fetchTweetFeed(username) {
  for (const baseUrl of NITTER_INSTANCES) {
    try {
      const rssUrl = `${baseUrl}/${username}/rss`;
      const feed = await parser.parseURL(rssUrl);
      if (feed && feed.items && feed.items.length > 0) {
        return feed;
      }
    } catch (e) {
      // 해당 미러 서버가 막혔을 경우 다음 서버 시도
      continue;
    }
  }
  return null;
}

async function checkLatestTweet(username, discordChannel) {
  try {
    const feed = await fetchTweetFeed(username);
    if (!feed || !feed.items || feed.items.length === 0) return;

    const latestTweet = feed.items[0];
    const tweetId = latestTweet.guid || latestTweet.link;

    if (lastTweetMap.get(username) === tweetId) return;

    if (!lastTweetMap.has(username)) {
      lastTweetMap.set(username, tweetId);
      return;
    }

    lastTweetMap.set(username, tweetId);

    let content = latestTweet.contentSnippet || latestTweet.content || '내용 없음';
    content = content.replace(/<[^>]*>/g, '').trim();

    const embed = new EmbedBuilder()
      .setColor('#1DA1F2')
      .setAuthor({
        name: `@${username} 님의 새로운 트윗`,
        iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png'
      })
      .setTitle(latestTweet.title ? latestTweet.title.substring(0, 256) : '새 트윗이 등록되었습니다.')
      .setURL(latestTweet.link)
      .setDescription(content)
      .setTimestamp(new Date(latestTweet.pubDate || Date.now()))
      .setFooter({ text: 'Twitter (X) 알림' });

    const btn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('트윗 보러가기')
        .setURL(latestTweet.link)
        .setStyle(ButtonStyle.Link)
    );

    await discordChannel.send({ embeds: [embed], components: [btn] });
  } catch (error) {
    console.log(`[Twitter Monitor] @${username} 동기화 확인 중...`);
  }
}

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
  }, 180000); // 3분 주기
}

module.exports = { checkLatestTweet, startTwitterMonitoring };