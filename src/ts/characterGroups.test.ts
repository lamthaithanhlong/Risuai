import { describe, expect, test } from 'vitest'
import { groupOf, moveToGroup, type OrderItem } from './characterGroups'

const g = (id: string, ...data: string[]) => ({ name: id, data, color: '', id })

describe('moveToGroup', () => {
    test('a new group takes the character and keeps its place in the list', () => {
        const out = moveToGroup(['a', 'b', 'c'], 'b', { kind: 'new', id: 'G', name: 'Group 1' })
        expect(out).toEqual(['a', { name: 'Group 1', data: ['b'], color: '', id: 'G' }, 'c'])
    })

    test('a character joins an existing group', () => {
        expect(moveToGroup(['a', g('G', 'x'), 'b'], 'b', { kind: 'folder', id: 'G' }))
            .toEqual(['a', g('G', 'x', 'b')])
    })

    test('five stories end up in one group', () => {
        let order: OrderItem[] = ['1', '2', '3', '4', '5', '6']
        order = moveToGroup(order, '1', { kind: 'new', id: 'G', name: 'Group 1' })
        for (const id of ['2', '3', '4', '5']) {
            order = moveToGroup(order, id, { kind: 'folder', id: 'G' })
        }
        expect(order).toEqual([{ name: 'Group 1', data: ['1', '2', '3', '4', '5'], color: '', id: 'G' }, '6'])
    })

    test('moving between groups empties and removes the old group', () => {
        expect(moveToGroup([g('A', 'x'), g('B', 'y')], 'x', { kind: 'folder', id: 'B' })).toEqual([g('B', 'y', 'x')])
    })

    test('leaving a group puts the character right after it', () => {
        expect(moveToGroup([g('A', 'x', 'y'), 'z'], 'x', { kind: 'none' })).toEqual([g('A', 'y'), 'x', 'z'])
    })

    test('the last character leaving removes the group and keeps its slot', () => {
        expect(moveToGroup(['a', g('A', 'x'), 'z'], 'x', { kind: 'none' })).toEqual(['a', 'x', 'z'])
    })

    test('an unknown target group or character changes nothing', () => {
        const order: OrderItem[] = ['a', g('A', 'x')]
        expect(moveToGroup(order, 'a', { kind: 'folder', id: 'nope' })).toEqual(order)
        expect(moveToGroup(order, 'ghost', { kind: 'folder', id: 'A' })).toEqual(order)
    })

    test('moving to where it already is changes nothing, and the input is never mutated', () => {
        const order: OrderItem[] = [g('A', 'x'), 'b']
        expect(moveToGroup(order, 'x', { kind: 'folder', id: 'A' })).toEqual(order)
        expect(moveToGroup(order, 'b', { kind: 'none' })).toEqual(order)
        moveToGroup(order, 'b', { kind: 'folder', id: 'A' })
        expect(order).toEqual([g('A', 'x'), 'b'])
    })
})

describe('groupOf', () => {
    test('finds the group or null', () => {
        const order: OrderItem[] = [g('A', 'x'), 'b']
        expect(groupOf(order, 'x')?.id).toBe('A')
        expect(groupOf(order, 'b')).toBeNull()
    })
})
