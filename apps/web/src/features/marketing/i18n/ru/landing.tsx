import type { LandingDict } from "../en/landing";

export const ruLanding: LandingDict = {
  meta: {
    title: "Loyal: кошелёк в Solana с автоматической доходностью",
    description:
      "Некастодиальный кошелёк в Solana сам направляет стейблкоины к лучшей доступной доходности. Ограничения для агентов, приватные переводы и открытый исходный код.",
    ogImageAlt:
      "Loyal: кошелёк в Solana, который автоматически приносит доход на стейблкоины",
  },
  hero: {
    headline: "Пусть свободные средства работают умнее",
    subtitle: (
      <>
        Подключите кошелёк один раз и автоматически зарабатывайте на своих
        средствах в Solana по лучшей доступной ставке
        <sup className="text-[0.65em]">
          <a
            aria-label="Примечание о ставке"
            className="no-underline"
            href="#rate-footnote"
          >
            1
          </a>
        </sup>
      </>
    ),
    startEarning: "Начать зарабатывать",
    openWebApp: "Открыть веб-приложение",
    downloadLoyal: "Скачать Loyal",
    phoneAlt:
      "Экран Loyal Earn с APY 9.48%, включённым Autodeposit и заработанными $822.66",
    animationAriaLabel:
      "Анимация приложения Loyal: подключите кошелёк, посмотрите, как растёт баланс, и настройте Autodeposit",
    moreInfo: "Подробнее",
    // {label} is the stat label.
    loadingTemplate: "Загрузка: {label}",
    statsAriaLabel: "Статистика Loyal",
    stats: {
      aum: {
        label: "Активы в Earn",
        tooltip:
          "Совокупная сумма средств, внесённых в активные политики маршрутизации Earn.",
      },
      volume: {
        label: "Объём оптимизаций",
        tooltip:
          "Общая сумма USDC, перераспределённая подтверждёнными оптимизациями Earn. Показатель отражает объём маршрутизации между резервами, поэтому один и тот же внесённый доллар может повторно учитываться в объёме, когда его переместит следующая оптимизация.",
      },
      users: {
        label: "Всего пользователей",
      },
    },
  },
  supportedBy: {
    title: "При поддержке",
  },
  features: {
    automation: {
      alt: "Три шага: подключите кошелёк, настройте Autodeposit и получайте лучший APY",
      text: "Откройте для себя мощную ончейн-автоматизацию, сохраняя полный контроль над средствами",
    },
    earn: {
      alt: "Экран Loyal Earn на телефоне с заработанными $192 и растущим графиком доходности",
      text: "Всегда получайте лучший низкорисковый APY в Solana на свободные средства с помощью автоматизаций Loyal",
    },
    actions: {
      alt: "Кнопки Send, Receive и Earn, а также включённый переключатель Privately",
      text: "Подключите любой кошелёк и пользуйтесь всеми возможностями в одном удобном интерфейсе",
    },
  },
  wallets: {
    title: "Несколько кошельков, один смарт-аккаунт",
    startEarning: "Зарабатывать",
    howItWorks: "Подробнее",
    phoneAnimationAriaLabel:
      "Кошелёк Loyal на телефоне: общий баланс, график доходности Earn, стейблкоины и криптоактивы",
  },
  developers: {
    technology: {
      title: "Узнайте о новейших технологиях Solana, на которых построен Loyal",
      cta: "Как это работает",
    },
    builders: {
      title: "Для разработчиков",
      cta: "Изучить SDK",
    },
  },
  trust: {
    title: "Ваши средства под защитой Squads",
    standard:
      "Squads задаёт стандарт смарт-аккаунтов в Solana. Ему доверяют более 450 команд, которые защищают с его помощью свыше $15 млрд. Loyal никогда не хранит ваши ключи.",
    automation:
      "Внутри вашего собственного аккаунта автоматизация Earn может только вносить средства в резервы Kamino из белого списка и выводить их оттуда. В худшем случае она выберет более низкую ставку. С октября 2025 года потерь средств пользователей не было.",
    securedCta: "Как защищены средства",
    risksCta: "Риски Earn",
  },
  blog: {
    title: "Новое от нашей команды",
  },
  getStarted: {
    title: "Как начать",
    platformAriaLabel: "Выбор платформы",
    segments: {
      Web: "Веб",
      Mobile: "Телефон",
      Extension: "Расширение",
    },
    previews: {
      Web: { alt: "Кошелёк в веб-приложении Loyal" },
      Mobile: { alt: "Кошелёк в мобильном приложении Loyal" },
      Extension: { alt: "Кошелёк в браузерном расширении Loyal" },
    },
    openWebApp: "Открыть приложение",
    comingSoon: "Скоро",
    seekerQrAriaLabel: "QR-код Seeker dApp Store",
    showSeekerQrAriaLabel: "Показать QR-код Seeker dApp Store",
    seekerQrTitle: "QR-код страницы Loyal в Seeker dApp Store",
    seekerOnly: "Доступно только на Seeker",
  },
};
