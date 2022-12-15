import { PsychicRollData, RollData, WeaponRollData } from './roll-data.mjs';
import { Hit, PsychicDamageData, scatterDirection, WeaponDamageData } from './damage-data.mjs';
import { getDegree, roll1d100, sendActionDataToChat, uuid } from './roll-helpers.mjs';
import { refundAmmo, useAmmo } from '../rules/ammo.mjs';
import { DHBasicActionManager } from '../actions/basic-action-manager.mjs';

export class ActionData {
    id = uuid();
    template = '';
    hasDamage = false;
    rollData;
    damageData;
    effects = [];
    effectOutput = [];

    reset() {
        this.effects = [];
        this.effectOutput = [];
        this.damageData.reset();
        this.rollData.reset();
    }

    async checkForPerils() {
        if (this.rollData.power) {
            if(this.rollData.sourceActor.psy.rating < this.rollData.pr) {
                if (!/^(.)\1+$/.test(this.rollData.roll.total)) {
                    this.addEffect('Psychic Phenomena', 'The warp convulses with energy!');
                }
            } else if (/^(.)\1+$/.test(this.rollData.roll.total)) {
                this.addEffect('Psychic Phenomena', 'The warp convulses with energy!');
            }
        }
    }

    async checkForOpposed() {
        if(this.rollData.isOpposed) {
            this.rollData.opposedRoll = await roll1d100();
            let rollTotal = this.rollData.opposedRoll.total;
            const target  = this.rollData.opposedTarget;
            this.rollData.opposedSuccess = rollTotal === 1 || (rollTotal <= target && rollTotal !== 100);

            if(this.rollData.opposedSuccess) {
                this.rollData.opposedDof = 0;
                this.rollData.opposedDos = 1 + getDegree(this.rollData.opposedTarget, this.rollData.opposedRoll.total);

                if(this.rollData.opposedDos >= this.rollData.dos) {
                    this.rollData.success = false;
                }
            } else {
                this.rollData.opposedDos = 0;
                this.rollData.opposedDof = 1 + getDegree(this.rollData.opposedRoll.total, this.rollData.opposedTarget);
            }
        }
    }

    async _calculateHit() {
        this.rollData.roll = await roll1d100();
        let rollTotal = this.rollData.roll.total;
        const target = this.rollData.modifiedTarget;
        this.rollData.success = rollTotal === 1 || (rollTotal <= target && rollTotal !== 100);
    }

    async calculateSuccessOrFailure() {
        await this._calculateHit();
        let actionItem = this.rollData.weapon ?? this.rollData.power;

        // Action Item
        if (actionItem) {
            // Stun Action
            if(this.rollData.action === 'Stun') {
                const stunRoll = new Roll(`1d10+${this.rollData.sourceActor.getCharacteristicFuzzy('Strength').bonus}`, {});
                await stunRoll.evaluate({ async: true });
                this.rollData.roll = stunRoll;

                if(this.rollData.targetActor) {
                    const defense = this.rollData.targetActor.system.armour.head.total;
                    if(stunRoll.total >= defense) {
                        this.rollData.success = true;
                        this.addEffect('Stun Attack', `Stun roll of ${stunRoll.total} vs ${defense}. Target is stunned for ${stunRoll.total - defense} rounds and gains 1 level of fatigue.`);
                    } else {
                        this.rollData.success = false;
                        this.addEffect('Stun Attack', `Stun roll of ${stunRoll.total} vs ${defense}. The attack fails to stun the target!`);
                    }
                } else {
                    this.rollData.success = true;
                    this.addEffect('Stun Attack', `Stun roll of ${stunRoll.total}. Compare to the target’s total of his Toughness bonus +1 per Armour point protecting his head. If the attacker’s roll is equal to or higher than this value, the target is Stunned for a number of rounds equal to the difference between the two values and gains one level of Fatigue.`);
                }
                return;
            }


            if(this.rollData.hasAttackSpecial('Spray')) {
                this.rollData.success = true;
                this.rollData.dos = 1;
                this.rollData.dof = 0;
                this.addEffect('Spray', 'Everyone in 30 degree arc must pass an agility test or be hit.')
            }

            if (actionItem.isMelee) {
                if (!this.rollData.success) {
                    // Re-Roll Attack for Blademaster
                    if (this.rollData.sourceActor.hasTalent('Blademaster')) {
                        this.effects.push('blademaster');
                        this.rollData.previousRolls.push(this.rollData.roll);
                        await this._calculateHit();
                    }
                }
            } else if (actionItem.isRanged) {
                // Suppressing Fire
                if (this.rollData.action === 'Suppressing Fire - Semi') {
                    this.addEffect('Suppressing', 'All targets within a 30 degree arc must pass a Difficult (-10) Pinning test for become Pinned.')
                } else if (this.rollData.action === 'Suppressing Fire - Full') {
                    this.addEffect('Suppressing', 'All targets within a 45 degree arc must pass a Hard (-20) Pinning test for become Pinned.')
                }

                const rollTotal = this.rollData.roll.total;
                if (rollTotal > 91 && this.rollData.hasAttackSpecial('Overheats')) {
                    this.effects.push('overheat');
                }
                if ((!this.rollData.hasAttackSpecial('Reliable') && rollTotal > 96) || rollTotal === 100) {
                    this.effects.push('jam');
                    this.rollData.success = false;
                }
            }
        }


        if (this.rollData.success) {
            this.rollData.dof = 0;
            this.rollData.dos = 1 + getDegree(this.rollData.modifiedTarget, this.rollData.roll.total);

            if (actionItem) {
                if (this.rollData.action === 'Semi-Auto Burst' ||
                    this.rollData.action === 'Swift Attack' ||
                    actionItem.isPsychicBarrage ||
                    this.rollData.action === 'Suppressing Fire - Semi' ||
                    this.rollData.action === 'Suppressing Fire - Full') {
                    if (this.rollData.hasWeaponModification('Fluid Action')) {
                        this.rollData.dos += 1;
                    }

                    // Possible Semi Rate
                    this.damageData.additionalHits += Math.floor((this.rollData.dos - 1) / 2);

                    // Storm
                    if (this.rollData.hasAttackSpecial('Storm')) {
                        this.damageData.additionalHits *= 2;
                    }

                    // But Max at fire rate (Ammo available / ammo per shot || rate of fire - whichever is lower)
                    if (actionItem.isRanged && this.damageData.additionalHits > this.rollData.fireRate - 1) {
                        this.damageData.additionalHits = this.rollData.fireRate - 1;
                    }
                } else if (this.rollData.action === 'Full Auto Burst' || this.rollData.action === 'Lightning Attack' || actionItem.isPsychicStorm) {
                    // Possible Full Rate
                    this.damageData.additionalHits += Math.floor(this.rollData.dos - 1);

                    // Storm
                    if (this.rollData.hasAttackSpecial('Storm')) {
                        this.damageData.additionalHits *= 2;
                    }

                    // But Max at weapon rate
                    if (actionItem.usesAmmo && this.damageData.additionalHits > this.rollData.fireRate - 1) {
                        this.damageData.additionalHits = this.rollData.fireRate - 1;
                    }
                }
            }

            if (this.rollData.dos > 1 && this.rollData.hasAttackSpecial('Twin-Linked')) {
                this.damageData.additionalHits++;
            }

        } else {
            this.rollData.dos = 0;
            this.rollData.dof = 1 + getDegree(this.rollData.roll.total, this.rollData.modifiedTarget);

            if(this.rollData.isThrown) {
                this.addEffect('Deviation', `The attack deviates [[ 1d5 ]]m off course to the ${scatterDirection()}!`);
            }

            if (this.rollData.roll.total === 100) {
                this.effects.push('auto-failure');
            }
        }
    }

    async calculateHits() {
        let lastLocation = '';
        if (this.rollData.success || this.rollData.isThrown) {
            let hit = await Hit.createHit(this);
            lastLocation = hit.location;
            this.damageData.hits.push(hit);

            for (let i = 0; i < this.damageData.additionalHits; i++) {
                hit = await Hit.createHit(this, lastLocation);
                lastLocation = hit.location;
                this.damageData.hits.push(hit);
            }
        }
    }

    addEffect(name, effect) {
        this.effectOutput.push({
            name: name,
            effect: effect
        })
    }

    async createEffectData() {
        for (const effect of this.effects) {
            switch(effect){
                case 'auto-failure':
                    this.addEffect('Auto Failure', `The roll resulted in an automatic failure!`);
                    break;
                case 'blademaster':
                    this.addEffect('Blademaster', `Original roll of ${this.rollData.previousRolls[0].total} rerolled.`);
                    break;
                case 'overheat':
                    this.addEffect('Overheats', `The weapon overheats forcing it to be dropped on the ground!`);
                    break;
                case 'jam':
                    this.addEffect('Jam', `The weapon jams!`);
                    break;
            }
        }
    }

    async descriptionText() {}

    async useResources() {
        // Expend Ammo
        await useAmmo(this);

        // Use a Fate for Eye of Vengeance
        if(this.rollData.eyeOfVengeance) {
            await this.rollData.sourceActor.spendFate();
        }
    }

    async refundResources() {
        // Refund Ammo
        await refundAmmo(this);

        // Use a Fate for Eye of Vengeance
        if(this.rollData.eyeOfVengeance) {
            await this.rollData.sourceActor.update({
                system: {
                    fate: {
                        value: this.rollData.sourceActor.system.fate.value + 1
                    }
                }
            });
        }
    }

    async performActionAndSendToChat() {
        // Store Roll Information
        DHBasicActionManager.storeActionData(this);

        // Finalize Modifiers
        await this.rollData.calculateTotalModifiers();

        // Determine Success/Hits
        await this.calculateSuccessOrFailure();

        if (this.rollData.action !== 'Stun') {
            await this.checkForOpposed();
            await this.checkForPerils();

            // Calculate Hits
            await this.calculateHits();

            // Create Specials
            await this.createEffectData();

            game.dh.log('Perform Action', this);

            // Description Text
            await this.descriptionText();

            // Use Resources
            await this.useResources();
        }

        // Render Attack Roll
        this.rollData.render = await this.rollData.roll.render();
        this.template = this.rollData.template;

        // Send to Chat
        await sendActionDataToChat(this);
    }
}

export class WeaponActionData extends ActionData {
    constructor() {
        super();
        this.template = 'systems/dark-heresy-2nd/templates/chat/action-roll-chat.hbs';
        this.hasDamage = true;
        this.rollData = new WeaponRollData();
        this.damageData = new WeaponDamageData();
    }
}

export class PsychicActionData extends ActionData {
    psychicEffect = '';

    constructor() {
        super();
        this.template = 'systems/dark-heresy-2nd/templates/chat/action-roll-chat.hbs';
        this.hasDamage = true;
        this.rollData = new PsychicRollData();
        this.damageData = new PsychicDamageData();
    }

    async performActionAndSendToChat() {
        if(!this.rollData.hasDamage) {
            this.rollData.template = 'systems/dark-heresy-2nd/templates/chat/psychic-action-chat.hbs';
            this.template = 'systems/dark-heresy-2nd/templates/chat/psychic-action-chat.hbs';
        }
        await super.performActionAndSendToChat();
    }

    async descriptionText() {
        if(this.rollData.power) {
            this.psychicEffect = await TextEditor.enrichHTML(this.rollData.power.system.description, {rollData: this.rollData});
        }
    }
}

export class PsychicSkillData extends ActionData {
    constructor() {
        super();
        this.template = 'systems/dark-heresy-2nd/templates/chat/action-roll-chat.hbs';
        this.hasDamage = false;
        this.rollData = new PsychicRollData();
    }
}

export class SimpleSkillData extends ActionData {
    constructor() {
        super();
        this.template = 'systems/dark-heresy-2nd/templates/chat/simple-roll-chat.hbs';
        this.hasDamage = false;
        this.rollData = new RollData();
    }
}
