import { world, system, ItemStack } from "@minecraft/server"
import { ActionFormData } from "@minecraft/server-ui"

// microsoft doc : https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/world?view=minecraft-bedrock-stable#getallplayers
// wiki : https://wiki.bedrock.dev/scripting/placement-prevention.html
// identifier ids : https://www.digminecraft.com/lists/item_id_list_pe.php

function get(key) {
    const d = world.getDynamicProperty(key)
    return d ? JSON.parse(d) : {}
}

function set(key, value) {
    return world.setDynamicProperty(key, JSON.stringify(value))
}

const Team = {
    key: 'teams',
    colors: ['Blue', 'Red'],
    set: (player, team) => {
        const teams = get(Team.key)
        teams[player.id] = team
        set(Team.key, teams)
    },
    get(player) {
        const teams = get(Team.key)
        return teams[player.id]
    }
}

const Base = {
    key: 'bases',
    size: 16, // max dist to center horizontally ; base size => 31x31
    height: 20, // max dist to center vertically (up to 20 above and below)
    set(team, location) {
        const bases = get(Base.key)
        bases[team] = location
        set(Base.key, bases)
    },
    get(team) {
        const bases = get(Base.key)
        return !team ? bases : bases[team]
    },
    inside(team, location) {
        const pos = Base.get(team)
        if (!pos) {
            logp(team, `no base found for team ${team}`)
            return false
        }
        return Math.abs(location.x - pos.x) < Base.size
            && Math.abs(location.z - pos.z) < Base.size
            && Math.abs(location.y - pos.y) < Base.height
    }
}

function logp(player, msg) {
    system.run(() => player.sendMessage(msg.toString()))
}

function inOverworld(player) {
    return player.dimension.id === 'minecraft:overworld'
}

// Prevent player to place a block outside its base except
// - tnt, torch, torch_redstone, lever, boat
const allowedOutsideBase = ['tnt', 'torch', 'lever', 'boat']
world.beforeEvents.itemUseOn.subscribe(event => {
    const { block, itemStack, source: player } = event

    const team = Team.get(player)
    if (!team) {
        logp(player, 'cannot use item when not in a team')
        event.cancel = true
        return
    }

    const base = Base.get(team)

	if (itemStack.typeId === "minecraft:firework_rocket") {
        if (base) {
            logp(player, `base already defined for team ${team}`)
            return
        }

        logp(player, `set ${team} base at (${block.location.x}, ${block.location.y}, ${block.location.z})`)
        Base.set(team, block.location)
        return
	}

    if (!base) {
        logp(player, `cannot use item when no base defined`)
        event.cancel = true
        return
    }

    // logp(player, itemStack.typeId)
    const isAllowed = allowedOutsideBase.some(d => itemStack.typeId.includes(d))
    const insideBase = Base.inside(team, block.location)
    if (inOverworld(player) && !isAllowed && !insideBase) {
        logp(player, 'cannot place block outside your base')
        event.cancel = true
    }
})

// TODO Prevent player to break block inside other bases
world.beforeEvents.playerBreakBlock.subscribe(event => {
    const { player, block } = event

    const team = Team.get(player)
    if (!team) {
        logp(player, 'cannot break block when not in a team')
        event.cancel = true
        return
    }

    for (const t in Base.get()) {
        if (team === t) continue
        if (Base.inside(t, block.location)) {
            logp(player, `cannot break block inside ${t} base`)
            event.cancel = true
        }
    }
})

// select your team, a firework is given to you
function showSelectTeamForm(event) {
    const player = event.source

    const team = Team.get(player)
    if (team) {
        logp(player, `[${player.name}] Already in the ${team} team!`)
        return Promise.resolve(true)
    }

    const form = new ActionFormData()
    form.title("Fallen Kingdoms")
    form.body("Choose your team")
    Team.colors.forEach(c => form.button(c))
    return form.show(player).then(r => {
        if (r.canceled) return false

        const c = Team.colors[r.selection]
        Team.set(player, c)
        logp(player, `${c} team!`)

        // give player firwork of its color
        const inventory = player.getComponent('minecraft:inventory')
        if (inventory && inventory.container) {
            const item = new ItemStack('minecraft:firework_rocket', 1);
            inventory.container.setItem(0, item);
        }

        return true
    }).catch(e => console.error(e, e.stack))
}

world.afterEvents.itemUse.subscribe(event => {
	if (event.itemStack.nameTag === "SelectTeam") {
        showSelectTeamForm(event)
	}
})

// on spawn, if you have no team,
// a stick is given to you to select your team
world.afterEvents.playerSpawn.subscribe(event => {
    const { player } = event

    const team = Team.get(player)
    if (!team) {
        const inventory = player.getComponent('minecraft:inventory')
        if (inventory && inventory.container) {
            const item = new ItemStack('minecraft:stick', 1)
            item.nameTag = "SelectTeam"
            inventory.container.setItem(0, item)
        }
    } else {
        world.sendMessage(`Welcome ${player.name} to the ${team} team!`)
    }
})

// TODO show day / pvp / nether / end