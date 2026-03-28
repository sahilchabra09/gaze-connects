import { ModeGridScreen } from "@/components/modes/mode-grid-screen";
import { getModuleCards } from "@/lib/mode-navigation";

export default function CallingPage() {
	return (
		<ModeGridScreen
			cards={getModuleCards("calling")}
		/>
	);
}

