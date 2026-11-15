/**
 * Refund negative cases for the localnet fixture (sc-task experiment patch-4-2026111517-1).
 * Extends the create-to-refund path on solana-test-validator with three negative cases:
 *   1. refund signed by a non-maker -> ConstraintRaw,
 *   2. refund against a mismatched escrow PDA -> AccountNotInitialized,
 *   3. refund attempted after the vault is already closed -> AccountNotInitialized,
 * while the positive create-to-refund path must still close vault and state.
 * Run from contract/: anchor test, or
 *   yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/refund-negative.ts
 */
import * as anchor from '@coral-xyz/anchor';
import { Program, BN } from '@coral-xyz/anchor';
import { GifterEscrow } from '../target/types/gifter_escrow';
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
	TOKEN_PROGRAM_ID,
	ASSOCIATED_TOKEN_PROGRAM_ID,
	createMint,
	getOrCreateAssociatedTokenAccount,
	mintTo,
	getAccount,
	getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { expect } from 'chai';

describe('refund negative cases in the localnet fixture', () => {
	const provider = anchor.AnchorProvider.env();
	anchor.setProvider(provider);
	const program = anchor.workspace.GifterEscrow as Program<GifterEscrow>;
	const connection = provider.connection;
	const payer = (provider.wallet as anchor.Wallet).payer;

	const maker = Keypair.generate();
	const impostor = Keypair.generate();
	const escrowId = new BN(1);
	const deposit = new BN(10_000_000); // 10 tokens, 6 decimals
	const want = new BN(5_000_000);
	const DEC = 6;
	const initialMinted = 1_000_000_000;

	let mintA: PublicKey;
	let mintB: PublicKey;
	let state: PublicKey;
	let vault: PublicKey;
	let makerTokenAccountA: PublicKey;
	let impostorTokenAccountA: PublicKey;

	const expectAnchorError = async (promise: Promise<unknown>, code: string) => {
		try {
			await promise;
		} catch (err: any) {
			const actual =
				err?.anchorError?.error?.errorCode?.code ?? err?.error?.errorCode?.code;
			expect(actual).to.equal(code);
			return;
		}
		throw new Error(`expected AnchorError ${code}, but the call succeeded`);
	};

	const refundAccounts = (signer: PublicKey, stateAccount: PublicKey, tokenAccount: PublicKey) => ({
		maker: signer,
		mintA,
		makerTokenAccountA: tokenAccount,
		gifterEscrowState: stateAccount,
		escrowVault: getAssociatedTokenAddressSync(mintA, stateAccount, true, TOKEN_PROGRAM_ID),
		systemProgram: SystemProgram.programId,
		associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
		tokenProgram: TOKEN_PROGRAM_ID,
	});

	it('setup: funds actors, creates mints and the escrow', async () => {
		for (const k of [maker, impostor]) {
			const sig = await connection.requestAirdrop(k.publicKey, 2 * LAMPORTS_PER_SOL);
			await connection.confirmTransaction(sig, 'confirmed');
		}

		mintA = await createMint(connection, payer, payer.publicKey, null, DEC);
		mintB = await createMint(connection, payer, payer.publicKey, null, DEC);

		const ataMA = await getOrCreateAssociatedTokenAccount(connection, payer, mintA, maker.publicKey);
		impostorTokenAccountA = (
			await getOrCreateAssociatedTokenAccount(connection, payer, mintA, impostor.publicKey)
		).address;
		await mintTo(connection, payer, mintA, ataMA.address, payer, initialMinted);

		state = PublicKey.findProgramAddressSync(
			[Buffer.from('gifter_escrow'), maker.publicKey.toBuffer(), escrowId.toArrayLike(Buffer, 'le', 8)],
			program.programId,
		)[0];
		vault = getAssociatedTokenAddressSync(mintA, state, true, TOKEN_PROGRAM_ID);
		makerTokenAccountA = ataMA.address;

		await program.methods
			.createEscrow(escrowId, deposit, want)
			.accounts({
				maker: maker.publicKey,
				mintA,
				mintB,
				makerTokenAccountA: ataMA.address,
				gifterEscrowState: state,
				escrowVault: vault,
				systemProgram: SystemProgram.programId,
				associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
				tokenProgram: TOKEN_PROGRAM_ID,
			})
			.signers([maker])
			.rpc();

		expect(Number((await getAccount(connection, vault)).amount)).to.equal(deposit.toNumber());
	});

	it('rejects refund signed by a non-maker', async () => {
		await expectAnchorError(
			program.methods.refund().accounts(refundAccounts(impostor.publicKey, state, impostorTokenAccountA)).rpc(),
			'ConstraintRaw',
		);
	});

	it('rejects refund against a mismatched escrow PDA', async () => {
		const wrongState = PublicKey.findProgramAddressSync(
			[Buffer.from('gifter_escrow'), maker.publicKey.toBuffer(), new BN(99).toArrayLike(Buffer, 'le', 8)],
			program.programId,
		)[0];
		await expectAnchorError(
			program.methods.refund().accounts(refundAccounts(maker.publicKey, wrongState, makerTokenAccountA)).rpc(),
			'AccountNotInitialized',
		);
	});

	it('positive: maker refund closes the vault and state accounts', async () => {
		await program.methods.refund().accounts(refundAccounts(maker.publicKey, state, makerTokenAccountA)).rpc();

		expect(await connection.getAccountInfo(vault)).to.equal(null);
		expect(await connection.getAccountInfo(state)).to.equal(null);
		expect(Number((await getAccount(connection, makerTokenAccountA)).amount)).to.equal(initialMinted);
	});

	it('rejects refund after the vault is already closed', async () => {
		expect(await connection.getAccountInfo(vault)).to.equal(null);
		await expectAnchorError(
			program.methods.refund().accounts(refundAccounts(maker.publicKey, state, makerTokenAccountA)).rpc(),
			'AccountNotInitialized',
		);
	});
});
