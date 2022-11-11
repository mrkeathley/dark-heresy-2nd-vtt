import { toggleUIExpanded } from '../../rules/config.mjs';

/**
 * Shared Actor functions for Actor that contains embedded items
 */
export class ActorContainerSheet extends ActorSheet {

    activateListeners(html) {
        super.activateListeners(html);

        // Everything below here is only needed if the sheet is editable
        if (!this.isEditable) return;

        html.find('.sheet-control__hide-control').click(async (ev) => await this._sheetControlHideToggle(ev));
        html.find('.item-roll').click(async (ev) => await this._onItemRoll(ev));
        html.find('.item-create').click(async (ev) => await this._onItemCreate(ev));
        html.find('.item-edit').click((ev) => this._onItemEdit(ev));
        html.find('.item-delete').click((ev) => this._onItemDelete(ev));
        html.find('.item-drag').each((i, item) => {
            if (item.dataset && item.dataset.itemId) {
                item.setAttribute('draggable', true);
                item.addEventListener('dragstart', this._onItemDragStart.bind(this), false);
            }
        });
    }

    async _onItemRoll(event) {
        event.preventDefault();
        const div = $(event.currentTarget);
        await this.actor.rollItem(div.data('itemId'));
    }

    async _onItemCreate(event) {
        event.preventDefault();
        const div = $(event.currentTarget);
        let data = {
            name: `New ${div.data('type').capitalize()}`,
            type: div.data('type'),
        };
        await this.actor.createEmbeddedDocuments('Item', [data], { renderSheet: true });
    }

    _onItemEdit(event) {
        event.preventDefault();
        const div = $(event.currentTarget);
        let item = this.actor.items.get(div.data('itemId'));
        item.sheet.render(true);
    }

    _onItemDelete(event) {
        event.preventDefault();
        Dialog.confirm({
            title: 'Confirm Delete',
            content: '<p>Are you sure you would like to delete this?</p>',
            yes: () => {
                const div = $(event.currentTarget);
                this.actor.deleteEmbeddedDocuments('Item', [div.data('itemId')]);
                div.slideUp(200, () => this.render(false));
            },
            no: () => {
            },
            defaultYes: false,
        });
    }

    /**
     * Generic Sheet Hide/Show option for all embedded fields
     */
    async _sheetControlHideToggle(event) {
        event.preventDefault();
        const displayToggle = $(event.currentTarget);
        $('span:first', displayToggle).toggleClass('active');
        const target = displayToggle.data('toggle');
        $('.' + target).toggle();
        toggleUIExpanded(target);
    }

    async _onItemDragStart(event) {
        event.stopPropagation();
        console.log('_onItemDragStart', event)

        const element = event.currentTarget;
        if (!element.dataset?.itemId) {
            console.warn('No Item Id - Cancelling Drag');
            return;
        }

        const itemId = element.dataset.itemId;
        const item = this.actor.items.find(i => i.id === itemId);
        if (!item) {
            // Cannot find item on actor? Just let foundry handle it...
            console.log('Default Foundry Handler');
            return super._onDragStart(event);
        }

        // Create drag data
        const dragData = {
            actorId: this.actor.id,
            sceneId: this.actor.isToken ? canvas.scene?.id : null,
            tokenId: this.actor.isToken ? this.actor.token?.id : null,
            type: 'Item',
            data: item,
        };
        event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
        await this.actor.deleteEmbeddedDocuments('Item', [itemId]);
    }

}