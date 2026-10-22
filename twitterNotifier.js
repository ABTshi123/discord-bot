const Parser = require('rss-parser');
const parser = new Parser();
const { EmbedBuilder } = require('discord.js');

// 마지막으로 확인한 트윗 ID 저장용
const lastTweetMap = new Map();

/**
 * 트위터 RSS 피드를 감지하여 새 트윗을 디스코드 채널로 전송
 * @param {string} username - 트위터 사용자 아이디 (예: 'arahashi_tabi')
 * @param {object} discordChannel - 알림을 보낼 디스코드 채널 객체
 */
async function checkLatestTweet(username, discordChannel) {
  try {
    // 무료 트위터 RSS 브릿지 URL (Nitter 계열)
    const rssUrl = `https://nitter.net/${username}/rss`;
    const feed = await parser.parseURL(rssUrl);

    if (!feed.items || feed.items.length === 0) return;

    const latestTweet = feed.items[0];
    const tweetId = latestTweet.guid || latestTweet.link;

    // 이전에 이미 보낸 트윗이면 건너뜀
    if (lastTweetMap.get(username) === tweetId) return;

    // 처음 켜졌을 때는 기준점만 잡고 메시지 전송은 패스
    if (!lastTweetMap.has(username)) {
      lastTweetMap.set(username, tweetId);
      return;
    }

    lastTweetMap.set(username, tweetId);

    // 디스코드 하늘색/파란색 트위터 임베드 카드 작성
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
    // Nitter 인스턴스 일시적 접속 불가시 무시하도록 처리
    console.log(`[Twitter Monitor Notice] @${username} 트윗 조회 중...`);
  }
}

module.exports = { checkLatestTweet };