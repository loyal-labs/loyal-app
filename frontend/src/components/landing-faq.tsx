"use client";

import { useState } from "react";

export type FaqItem = {
  question: string;
  answer: string;
};

export const LANDING_FAQS: FaqItem[] = [
  {
    question: "What is Loyal?",
    answer:
      "Every wallet address is a Smart Account with its own policies and spending caps so your agents can never spend more or send funds somewhere you didn't approve.",
  },
  {
    question: "How can I use Loyal?",
    answer:
      "Start with the browser extension or web app, create a shielded wallet, and approve only the permissions each app or agent needs.",
  },
  {
    question: "Can I create more than one wallet?",
    answer:
      "Yes. You can keep multiple wallets under one smart account and separate balances, apps, agents, and permissions by workflow.",
  },
  {
    question: "How can I connect my Loyal wallet with other apps?",
    answer:
      "Connect through the Loyal extension or supported wallet flows, then set the exact signing, spending, and execution permissions for that app.",
  },
  {
    question: "What are Smart Accounts?",
    answer:
      "Smart Accounts are programmable wallets that can enforce rules before a transaction is signed or executed, such as limits, allowed destinations, and agent permissions.",
  },
  {
    question: "Can I import my existing wallet into Loyal?",
    answer:
      "You will be able to bring existing wallets into Loyal flows while keeping clear separation between imported keys and delegated smart-account permissions.",
  },
  {
    question:
      "How are private transfers different from normal onchain transfers?",
    answer:
      "Normal onchain transfers expose addresses and amounts directly. Loyal private transfers are designed to keep transaction intent and balances shielded while still settling onchain.",
  },
  {
    question: "Can I use Loyal across devices and platforms?",
    answer:
      "Yes. Loyal is being built for browser, web, and mobile so the same account model can follow you across devices.",
  },
];

export function LandingFaq({ items = LANDING_FAQS }: { items?: FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const faqs = items;

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };

  return (
    <section
      className="flex w-full justify-center bg-white px-4 py-12 lg:px-6 lg:py-24"
      id="faq"
    >
      {/* FAQPage JSON-LD, generated from the same items rendered below so the
          two can never drift. Rendered as script children (not
          dangerouslySetInnerHTML): React escapes <, >, & — preventing script
          breakout — and the browser decodes them back via textContent. */}
      <script type="application/ld+json">{JSON.stringify(faqSchema)}</script>
      <div className="grid w-full max-w-[560px] gap-10 lg:max-w-[1560px] lg:grid-cols-2 lg:gap-6">
        <div className="pb-12 lg:pb-0" data-reveal="left">
          <h2 className="text-[48px] font-semibold leading-[48px] text-black">
            Questions?
            <br />
            Answers.
          </h2>
        </div>

        <div className="bg-white" data-reveal="right" data-reveal-delay="1">
          {faqs.map((faq, index) => {
            const isOpen = openIndex === index;
            const answerId = `faq-answer-${index}`;

            return (
              <div className="group" key={faq.question}>
                <button
                  aria-controls={answerId}
                  aria-expanded={isOpen}
                  className="flex w-full cursor-pointer gap-8 px-3 py-5 pr-5 text-left transition-colors duration-200 ease-out hover:text-[#f9363c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:ring-offset-2"
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                  type="button"
                >
                  <span className="relative mt-0.5 h-6 w-6 shrink-0 text-current">
                    <span className="absolute left-[1.7px] top-[10.7px] h-[2.6px] w-[20.6px] rounded-full bg-current transition-transform duration-300 ease-out" />
                    <span
                      className={`absolute left-[10.7px] top-[1.7px] h-[20.6px] w-[2.6px] rounded-full bg-current transition duration-300 ease-out ${
                        isOpen
                          ? "scale-y-0 opacity-0"
                          : "scale-y-100 opacity-100"
                      }`}
                    />
                  </span>

                  <span className="block min-w-0">
                    <span className="block text-[24px] font-medium leading-[1.1] text-black transition-colors duration-200 ease-out group-hover:text-[#f9363c]">
                      {faq.question}
                    </span>
                  </span>
                </button>

                <div
                  className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
                    isOpen
                      ? "grid-rows-[1fr] opacity-100"
                      : "grid-rows-[0fr] opacity-0"
                  }`}
                  id={answerId}
                >
                  <div className="min-h-0 overflow-hidden">
                    <p
                      className={`max-w-[600px] pb-5 pl-[68px] pr-5 text-[18px] font-normal leading-[1.3] text-[#3c3c43]/60 transition duration-300 ease-out ${
                        isOpen ? "translate-y-0" : "-translate-y-1"
                      }`}
                    >
                      {faq.answer}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
