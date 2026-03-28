import { ModeGridScreen } from "@/components/modes/mode-grid-screen";
import { HOME_CARDS } from "@/lib/mode-navigation";

export default function Home() {
  return <ModeGridScreen cards={HOME_CARDS} />;
}
