import * as React from 'react';
import { Navbar, NavbarSection, NavbarItem } from '../ui/navbar';
import clsx from 'clsx';

export interface Tab {
	id: string;
	label: string;
	content: React.ReactNode;
	disabled?: boolean;
}

export interface TabbedContainerProps {
	label?: React.ReactNode;
	tabs: Tab[];
	defaultActiveTab?: string;
	onTabChange?: (tabId: string) => void;
	className?: string;
	tabsClassName?: string;
	contentClassName?: string;
}

export const TabbedContainer: React.FC<TabbedContainerProps> = ({
	label,
	tabs,
	defaultActiveTab,
	onTabChange,
	className,
	tabsClassName,
	contentClassName,
}) => {
	const [activeTab, setActiveTab] = React.useState<string>(defaultActiveTab || tabs[0]?.id || '');

	const handleTabClick = React.useCallback(
		(tabId: string) => {
			setActiveTab(tabId);
			onTabChange?.(tabId);
		},
		[onTabChange]
	);

	const activeTabContent = React.useMemo(() => {
		return tabs.find((tab) => tab.id === activeTab)?.content;
	}, [tabs, activeTab]);

	if (!tabs.length) {
		return null;
	}

	return (
		<div className={clsx('h-full flex flex-col', className)}>
			{/* Tab Navigation using Navbar components */}
			<Navbar
				style={{ flex: 'none' }}
				className={clsx(
					'border-b border-zinc-200 dark:border-zinc-700 flex justify-between flex-shrink-0',
					tabsClassName
				)}
			>
				<div>{label}</div>
				<NavbarSection>
					{tabs.map((tab) => (
						<NavbarItem
							key={tab.id}
							current={activeTab === tab.id}
							onClick={() => !tab.disabled && handleTabClick(tab.id)}
							disabled={tab.disabled}
							role="tab"
							aria-selected={activeTab === tab.id}
							aria-controls={`tabpanel-${tab.id}`}
							tabIndex={activeTab === tab.id ? 0 : -1}
						>
							{tab.label}
						</NavbarItem>
					))}
				</NavbarSection>
			</Navbar>

			{/* Tab Content */}
			<div
				className={clsx('flex-1 min-h-0 mt-2', contentClassName)}
				role="tabpanel"
				id={`tabpanel-${activeTab}`}
				aria-labelledby={`tab-${activeTab}`}
				tabIndex={0}
			>
				{activeTabContent}
			</div>
		</div>
	);
};

export default TabbedContainer;
