import { Badge } from "../ui/badge";
import type { ScheduleStatus } from "../types/schedule.types";

// Define a type for the badge colors
type BadgeColor =
    | "indigo"
    | "emerald"
    | "red"
    | "orange"
    | "amber"
    | "yellow"
    | "lime"
    | "green"
    | "teal"
    | "cyan"
    | "sky"
    | "blue"
    | "violet"
    | "purple"
    | "fuchsia"
    | "pink"
    | "rose"
    | "zinc";

// Use string literal keys matching ScheduleStatus union type
const badgeColor: Record<ScheduleStatus, BadgeColor> = {
    pending: "indigo",
    queued: "sky",
    processing: "amber",
    sent: "emerald",
    retrying: "yellow",
    delivered: "green",
    failed: "orange",
    cancelled: "zinc",
};

export function StatusBadge({ status }: { status: ScheduleStatus }) {
    return <Badge color={badgeColor[status]}>{status}</Badge>;
}
