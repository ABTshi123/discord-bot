require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { startChzzkMonitoring, getConfig, saveConfig, getChannelName } = require('./chzzkNotifier');
const { startYoutubeMonitoring, getYoutubeChannelInfo } = require('./youtubeNotifier');

// 1. Render 웹서버 및 업타임로봇 Health Check 포트 바인딩
const app = express();
app.get('/', (req, res) => res.status(200).send('Bot is Live!'));
app.head('/', (req, res) => res.status(200).end());
app.get('/health', (req, res) => res.status(200).send('OK'));

app.listen(process.env.PORT || 3000, () => {
  console.log('🌐 Express Web Server is running on port ' + (process.env.PORT || 3000));
});

// 2. 디스코드 클라이언트 생성
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// 3. 디스코드 슬래시 커맨드 정의 (치지직 & 유튜브 전용)
const commands = [
  // --- 치지직 커맨드 ---
  new SlashCommandBuilder()
    .setName('치지직등록')
    .setDescription('치지직 채널 알림을 설정합니다.')
    .addStringOption(opt => opt.setName('치지직id').setDescription('치지직 라이브 주소의 channel ID').setRequired(true))
    .addChannelOption(opt => opt.setName('알림채널').setDescription('알림을 전송할 디스코드 채널').setRequired(true)),

  new SlashCommandBuilder()
    .setName('치지직목록')
    .setDescription('현재 등록된 치지직 알림 채널 목록을 조회합니다.'),

  new SlashCommandBuilder()
    .setName('치지직삭제')
    .setDescription('등록된 치지직 알림 채널을 삭제합니다.')
    .addStringOption(opt => opt.setName('치지직id').setDescription('삭제할 치지직 channel ID').setRequired(true)),

  // --- 유튜브 커맨드 ---
  new SlashCommandBuilder()
    .setName('유튜브등록')
    .setDescription('유튜브 채널 알림을 설정합니다.')
    .addStringOption(opt => opt.setName('유튜브id').setDescription('유튜브 채널 ID (UC...)').setRequired(true))
    .addChannelOption(opt => opt.setName('알림채널').setDescription('알림을 전송할 디스코드 채널').setRequired(true)),

  new SlashCommandBuilder()
    .setName('유튜브목록')
    .setDescription('현재 등록된 유튜브 알림 채널 목록을 조회합니다.'),

  new SlashCommandBuilder()
    .setName('유튜브삭제')
    .setDescription('등록된 유튜브 알림 채널을 삭제합니다.')
    .addStringOption(opt => opt.setName('유튜브id').setDescription('삭제할 유튜브 channel ID').setRequired(true)),
].map(cmd => cmd.toJSON());

// 4. 봇 로그인 및 커맨드 등록
client.once('ready', async () => {
  console.log(`🤖 봇이 성공적으로 로그인되었습니다: ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    console.log('슬래시 커맨드 등록 중...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('슬래시 커맨드 등록 완료!');
  } catch (err) {
    console.error('커맨드 등록 실패:', err);
  }

  // 치지직 & 유튜브 모니터링 엔진만 실행
  startChzzkMonitoring(client);
  startYoutubeMonitoring(client);
});

// 5. 슬래시 커맨드 수신 처리
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const config = getConfig();

  try {
    // --- 치지직 명령어 ---
    if (commandName === '치지직등록') {
      await interaction.deferReply({ ephemeral: true });
      const chId = interaction.options.getString('치지직id');
      const targetChannel = interaction.options.getChannel('알림채널');

      let streamerName = '스트리머';
      try {
        if (typeof getChannelName === 'function') {
          const name = await getChannelName(chId);
          if (name) streamerName = name;
        }
      } catch (e) {
        console.log('[Chzzk Name Error]:', e.message);
      }

      if (!config.chzzk) config.chzzk = {};
      config.chzzk[chId] = { channelId: targetChannel.id, name: streamerName };
      saveConfig(config);

      await interaction.editReply({ content: `✅ **${streamerName}** (\`${chId}\`) 채널 알림이 <#${targetChannel.id}> 채널로 등록되었습니다!` });
    } 
    else if (commandName === '치지직목록') {
      if (!config.chzzk || Object.keys(config.chzzk).length === 0) {
        return await interaction.reply({ content: '📋 현재 등록된 치지직 알림 채널이 없습니다.', ephemeral: true });
      }
      let listText = '';
      for (const chId in config.chzzk) {
        const item = config.chzzk[chId];
        listText += `• **스트리머**: **${item.name || '알 수 없음'}** (\`${chId}\`) ➡️ **알림 채널**: <#${item.channelId}>\n`;
      }
      const embed = new EmbedBuilder().setColor('#00FFA3').setTitle('📋 등록된 치지직 알림 목록').setDescription(listText);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    } 
    else if (commandName === '치지직삭제') {
      const chId = interaction.options.getString('치지직id');
      if (!config.chzzk || !config.chzzk[chId]) {
        return await interaction.reply({ content: `❌ 등록되지 않은 치지직 ID입니다: \`${chId}\``, ephemeral: true });
      }
      const streamerName = config.chzzk[chId].name || '스트리머';
      delete config.chzzk[chId];
      saveConfig(config);
      await interaction.reply({ content: `❌ **${streamerName}** (\`${chId}\`) 채널 알림이 삭제되었습니다.`, ephemeral: true });
    }

    // --- 유튜브 명령어 ---
    else if (commandName === '유튜브등록') {
      await interaction.deferReply({ ephemeral: true });
      const ytId = interaction.options.getString('유튜브id');
      const targetChannel = interaction.options.getChannel('알림채널');

      let channelTitle = '유튜브 채널';
      try {
        const ytInfo = await getYoutubeChannelInfo(ytId);
        if (ytInfo && ytInfo.title) channelTitle = ytInfo.title;
      } catch (e) {}

      if (!config.youtube) config.youtube = {};
      config.youtube[ytId] = { channelId: targetChannel.id, name: channelTitle };
      saveConfig(config);

      await interaction.editReply({ content: `✅ 유튜브 **${channelTitle}** (\`${ytId}\`) 채널 알림이 <#${targetChannel.id}> 채널로 등록되었습니다!` });
    } 
    else if (commandName === '유튜브목록') {
      if (!config.youtube || Object.keys(config.youtube).length === 0) {
        return await interaction.reply({ content: '📋 현재 등록된 유튜브 알림 채널이 없습니다.', ephemeral: true });
      }
      let listText = '';
      for (const ytId in config.youtube) {
        const item = config.youtube[ytId];
        listText += `• **유튜브 채널**: **${item.name || '알 수 없음'}** (\`${ytId}\`) ➡️ **알림 채널**: <#${item.channelId}>\n`;
      }
      const embed = new EmbedBuilder().setColor('#FF0000').setTitle('📋 등록된 유튜브 알림 목록').setDescription(listText);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    } 
    else if (commandName === '유튜브삭제') {
      const ytId = interaction.options.getString('유튜브id');
      if (!config.youtube || !config.youtube[ytId]) {
        return await interaction.reply({ content: `❌ 등록되지 않은 유튜브 ID입니다: \`${ytId}\``, ephemeral: true });
      }
      const channelName = config.youtube[ytId].name || '유튜브 채널';
      delete config.youtube[ytId];
      saveConfig(config);
      await interaction.reply({ content: `❌ **${channelName}** (\`${ytId}\`) 유튜브 채널 알림이 삭제되었습니다.`, ephemeral: true });
    }
  } catch (error) {
    console.error(`[Command Error] ${commandName}:`, error);
    if (interaction.deferred) {
      await interaction.editReply({ content: '❌ 처리 중 오류가 발생했습니다. 다시 시도해 주세요.' }).catch(() => null);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);