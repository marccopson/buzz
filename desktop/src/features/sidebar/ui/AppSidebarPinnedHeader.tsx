import {
  Activity,
  Bot,
  Gauge,
  FolderGit2,
  Inbox,
  ListChecks,
  ListTodo,
  Sun,
  Zap,
} from "lucide-react";

import { TopbarSearch } from "@/features/search/ui/TopbarSearch";
import { FeatureGate } from "@/shared/features";
import type { Channel, SearchHit } from "@/shared/api/types";
import {
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";

type SidebarSelectedView =
  | "home"
  | "today"
  | "channel"
  | "messages"
  | "agents"
  | "workflows"
  | "pulse"
  | "projects"
  | "running-order"
  | "control-room"
  | "my-actions";

type AppSidebarPinnedHeaderProps = {
  channelLabels: Record<string, string>;
  currentPubkey?: string;
  onBrowseChannels?: () => void;
  onCreateAgent: () => void;
  onCreateChannel: () => void;
  onOpenDm: (input: { pubkeys: string[] }) => Promise<void>;
  onOpenSearchResult: (hit: SearchHit) => void;
  onSelectChannel: (channelId: string) => void;
  searchChannels: Channel[];
  searchFocusRequest: number;
  suggestionChannels: Channel[];
};

type AppSidebarPrimaryMenuProps = {
  homeBadgeCount: number;
  onSelectAgents: () => void;
  onSelectControlRoom: () => void;
  onSelectHome: () => void;
  onSelectMyActions: () => void;
  onSelectProjects: () => void;
  onSelectPulse: () => void;
  onSelectRunningOrder: () => void;
  onSelectToday: () => void;
  onSelectWorkflows: () => void;
  selectedView: SidebarSelectedView;
  workspaceModules?: readonly string[] | null;
};

export function AppSidebarPinnedHeader({
  channelLabels,
  currentPubkey,
  onBrowseChannels,
  onCreateAgent,
  onCreateChannel,
  onOpenDm,
  onOpenSearchResult,
  onSelectChannel,
  searchChannels,
  searchFocusRequest,
  suggestionChannels,
}: AppSidebarPinnedHeaderProps) {
  return (
    <div
      className="mx-[3px] shrink-0 px-2 pb-2 pt-3"
      data-testid="sidebar-pinned-header"
    >
      <TopbarSearch
        channelLabels={channelLabels}
        channels={searchChannels}
        currentPubkey={currentPubkey}
        focusRequest={searchFocusRequest}
        onOpenChannel={onSelectChannel}
        onOpenResult={onOpenSearchResult}
        onOpenUser={(user) => onOpenDm({ pubkeys: [user.pubkey] })}
        onBrowseChannels={onBrowseChannels}
        onCreateAgent={onCreateAgent}
        onCreateChannel={onCreateChannel}
        suggestionChannels={suggestionChannels}
      />
    </div>
  );
}

export function AppSidebarPrimaryMenu({
  homeBadgeCount,
  onSelectAgents,
  onSelectControlRoom,
  onSelectHome,
  onSelectMyActions,
  onSelectProjects,
  onSelectPulse,
  onSelectRunningOrder,
  onSelectToday,
  onSelectWorkflows,
  selectedView,
  workspaceModules,
}: AppSidebarPrimaryMenuProps) {
  const hasProjectedContext = Array.isArray(workspaceModules);
  const canUseAgents =
    !hasProjectedContext || workspaceModules.includes("agents");
  const canUseRunningOrder =
    !hasProjectedContext || workspaceModules.includes("running_order");
  const canUseControlRoom = canUseAgents && canUseRunningOrder;
  const canUseTechnicalTools = canUseAgents || canUseRunningOrder;

  return (
    <SidebarHeader
      className="relative z-40 cursor-default select-none px-2 pb-0 pt-0"
      data-tauri-drag-region
      data-testid="sidebar-primary-menu"
    >
      <SidebarMenu className="pb-2">
        <SidebarMenuItem>
          <SidebarMenuButton
            data-testid="open-today-view"
            isActive={selectedView === "today"}
            onClick={onSelectToday}
            tooltip="Today"
            type="button"
          >
            <Sun className="h-4 w-4" />
            <SidebarMenuLabel>Today</SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={selectedView === "home"}
            onClick={onSelectHome}
            tooltip="Inbox"
            type="button"
          >
            <Inbox className="h-4 w-4" />
            <SidebarMenuLabel>Inbox</SidebarMenuLabel>
          </SidebarMenuButton>
          {homeBadgeCount > 0 ? (
            <SidebarMenuBadge
              className="right-2 rounded-full bg-primary/15 px-1.5 text-2xs text-primary peer-data-[active=true]/menu-button:bg-sidebar-active-foreground/20 peer-data-[active=true]/menu-button:text-sidebar-active-foreground"
              data-testid="sidebar-home-count"
            >
              {Math.min(homeBadgeCount, 99)}
            </SidebarMenuBadge>
          ) : null}
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            data-testid="open-my-actions-view"
            isActive={selectedView === "my-actions"}
            onClick={onSelectMyActions}
            tooltip="My Actions"
            type="button"
          >
            <ListTodo className="h-4 w-4" />
            <SidebarMenuLabel>My Actions</SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {canUseTechnicalTools ? (
          <FeatureGate feature="pulse">
            <SidebarMenuItem>
              <SidebarMenuButton
                data-testid="open-pulse-view"
                isActive={selectedView === "pulse"}
                onClick={onSelectPulse}
                tooltip="Pulse"
                type="button"
              >
                <Activity className="h-4 w-4" />
                <SidebarMenuLabel>Pulse</SidebarMenuLabel>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </FeatureGate>
        ) : null}
        {canUseTechnicalTools ? (
          <FeatureGate feature="projects">
            <SidebarMenuItem>
              <SidebarMenuButton
                data-testid="open-projects-view"
                isActive={selectedView === "projects"}
                onClick={onSelectProjects}
                tooltip="Projects"
                type="button"
              >
                <FolderGit2 className="h-4 w-4" />
                <SidebarMenuLabel>Projects</SidebarMenuLabel>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </FeatureGate>
        ) : null}
        {canUseRunningOrder ? (
          <SidebarMenuItem>
            <SidebarMenuButton
              data-testid="open-running-order-view"
              isActive={selectedView === "running-order"}
              onClick={onSelectRunningOrder}
              tooltip="COS Running Order"
              type="button"
            >
              <ListChecks className="h-4 w-4" />
              <SidebarMenuLabel>COS Running Order</SidebarMenuLabel>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
        {canUseControlRoom ? (
          <SidebarMenuItem>
            <SidebarMenuButton
              data-testid="open-control-room-view"
              isActive={selectedView === "control-room"}
              onClick={onSelectControlRoom}
              tooltip="Control Room"
              type="button"
            >
              <Gauge className="h-4 w-4" />
              <SidebarMenuLabel>Control Room</SidebarMenuLabel>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
        {canUseAgents ? (
          <SidebarMenuItem>
            <SidebarMenuButton
              data-testid="open-agents-view"
              isActive={selectedView === "agents"}
              onClick={onSelectAgents}
              tooltip="Agents"
              type="button"
            >
              <Bot className="h-4 w-4" />
              <SidebarMenuLabel>Agents</SidebarMenuLabel>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
        {canUseTechnicalTools ? (
          <FeatureGate feature="workflows">
            <SidebarMenuItem>
              <SidebarMenuButton
                data-testid="open-workflows-view"
                isActive={selectedView === "workflows"}
                onClick={onSelectWorkflows}
                tooltip="Workflows"
                type="button"
              >
                <Zap className="h-4 w-4" />
                <SidebarMenuLabel>Workflows</SidebarMenuLabel>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </FeatureGate>
        ) : null}
      </SidebarMenu>
    </SidebarHeader>
  );
}
