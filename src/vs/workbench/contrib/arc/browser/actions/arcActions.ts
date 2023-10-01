/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Codicon } from 'vs/base/common/codicons';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { localize } from 'vs/nls';
import { Action2, MenuId } from 'vs/platform/actions/common/actions';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';
import { IArcWidgetService } from 'vs/workbench/contrib/arc/browser/arc';

export const ARC_CATEGORY = { value: localize('arc.category', "Arc"), original: 'Arc' };
const toggleArcIcon = registerIcon('toggle-arc-icon', Codicon.squirrel, localize('toggleArcIcon', 'Icon represents Arc visibility.'));

/**
 * Returns a provider specific action that will toggle the arc for that provider.
 * This is used to include the provider label in the action title so it shows up in
 * the command palette.
 * @param id The id of the provider
 * @param label The label of the provider
 * @returns An action that will toggle the arc for this provider
 */
export function getArcActionsForProvider(id: string, label: string) {
	return [
		class ToggleArcAction extends Action2 {
			constructor() {
				super({
					id: `workbench.action.toggleArc.${id}`,
					category: ARC_CATEGORY,
					title: { value: localize('arcSession.toggle', "Toggle Arc ({0})", label), original: `Toggle Arc (${label})` },
					f1: true,
					icon: toggleArcIcon,
					menu: [
						{
							id: MenuId.LayoutControlMenu,
							group: 'z_end'
						}
					]
				});
			}

			override run(accessor: ServicesAccessor, query?: string): void {
				const arcWidgetService = accessor.get(IArcWidgetService);
				arcWidgetService.toggle();
			}
		}
	];
}
