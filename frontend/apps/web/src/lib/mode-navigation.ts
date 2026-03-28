export type ModeKey = "appliances" | "necessity" | "messaging" | "calling" | "talk-live";

export type GridIcon =
  | "back"
  | "next"
  | "appliances"
  | "necessity"
  | "messaging"
  | "calling"
  | "talk-live"
  | "option";

export type GridCard = {
  id: string;
  label: string;
  href?: string;
  icon: GridIcon;
};

const MODE_ORDER: ModeKey[] = ["appliances", "necessity", "messaging", "calling", "talk-live"];

export const HOME_CARDS: GridCard[] = [
  {
    id: "home-appliances",
    label: "Appliances",
    href: "/appliances",
    icon: "appliances",
  },
  {
    id: "home-necessity",
    label: "Necessity",
    href: "/necessity",
    icon: "necessity",
  },
  {
    id: "home-messaging",
    label: "Messaging",
    href: "/messaging",
    icon: "messaging",
  },
  {
    id: "home-calling",
    label: "Calling",
    href: "/calling",
    icon: "calling",
  },
  {
    id: "home-talk-live",
    label: "Talk Live",
    href: "/talk-live",
    icon: "talk-live",
  },
  {
    id: "home-next",
    label: "Next",
    href: "/necessity",
    icon: "next",
  },
];

export function getModuleCards(mode: ModeKey): GridCard[] {
  const currentIndex = MODE_ORDER.findIndex((item) => item === mode);
  const nextModeHref =
    currentIndex >= MODE_ORDER.length - 1 ? "/" : `/${MODE_ORDER[currentIndex + 1]}`;

  return [
    {
      id: `${mode}-previous`,
      label: "Back",
      href: "/",
      icon: "back",
    },
    {
      id: `${mode}-option-1`,
      label: "Option 1",
      href: `/options/${mode}/1`,
      icon: "option",
    },
    {
      id: `${mode}-option-2`,
      label: "Option 2",
      href: `/options/${mode}/2`,
      icon: "option",
    },
    {
      id: `${mode}-option-3`,
      label: "Option 3",
      href: `/options/${mode}/3`,
      icon: "option",
    },
    {
      id: `${mode}-option-4`,
      label: "Option 4",
      href: `/options/${mode}/4`,
      icon: "option",
    },
    {
      id: `${mode}-next`,
      label: "Next",
      href: nextModeHref,
      icon: "next",
    },
  ];
}
