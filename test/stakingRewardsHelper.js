const { expect } = require("chai");
const { ethers, waffle } = require("hardhat");

describe('StakingRewardsHelper', async () => {
  const toWei = ethers.utils.parseEther;
  const SEVEN_DAYS = 86400 * 7;

  let rewardsToken;
  let stakingToken1, stakingToken2;
  let stakingRewards1, stakingRewards2;

  let stakingRewardsHelper;
  let stakingRewardsFactory;
  let stakingRewardsContractFactory;

  let accounts;
  let admin, adminAddress;
  let user1, user1Address;

  beforeEach(async () => {
    accounts = await ethers.getSigners();
    admin = accounts[0];
    adminAddress = await admin.getAddress();
    user1 = accounts[1];
    user1Address = await user1.getAddress();

    const tokenFactory = await ethers.getContractFactory('MockToken');
    stakingToken1 = await tokenFactory.deploy();
    stakingToken2 = await tokenFactory.deploy();
    rewardsToken = await tokenFactory.deploy();

    const stakingRewardsFactoryFactory = await ethers.getContractFactory('StakingRewardsFactory');
    stakingRewardsFactory = await stakingRewardsFactoryFactory.deploy();

    const stakingRewardsHelperFactory = await ethers.getContractFactory('StakingRewardsHelper');
    stakingRewardsHelper = await stakingRewardsHelperFactory.deploy(stakingRewardsFactory.address);

    // Deploy 2 staking rewards contracts via factory.
    await stakingRewardsFactory.createStakingRewards([stakingToken1.address, stakingToken2.address], stakingRewardsHelper.address);

    stakingRewardsContractFactory = await ethers.getContractFactory('StakingRewards');
    const stakingRewards1Address = await stakingRewardsFactory.getStakingRewards(stakingToken1.address);
    stakingRewards1 = stakingRewardsContractFactory.attach(stakingRewards1Address);
    const stakingRewards2Address = await stakingRewardsFactory.getStakingRewards(stakingToken2.address);
    stakingRewards2 = stakingRewardsContractFactory.attach(stakingRewards2Address);

    // Setup rewards tokens for staking rewards contracts.
    await Promise.all([
      stakingRewards1.addRewardsToken(rewardsToken.address, SEVEN_DAYS),
      stakingRewards2.addRewardsToken(rewardsToken.address, SEVEN_DAYS),
      rewardsToken.transfer(stakingRewards1.address, toWei('100')),
      rewardsToken.transfer(stakingRewards2.address, toWei('100')),
    ]);

    await Promise.all([
      stakingRewards1.notifyRewardAmount(rewardsToken.address, toWei('10')),
      stakingRewards2.notifyRewardAmount(rewardsToken.address, toWei('20'))
    ]);

    // Give user1 some staking tokens.
    await Promise.all([
      stakingToken1.transfer(user1Address, toWei('100')),
      stakingToken2.transfer(user1Address, toWei('100'))
    ]);
  });

  describe('claimAllRewards / claimRewards / getUserClaimableRewards / getUserStaked', async () => {
    beforeEach(async () => {
      await Promise.all([
        stakingToken1.connect(user1).approve(stakingRewards1.address, toWei('100')),
        stakingToken2.connect(user1).approve(stakingRewards2.address, toWei('100'))
      ]);
      await Promise.all([
        stakingRewards1.connect(user1).stake(toWei('100')),
        stakingRewards2.connect(user1).stake(toWei('100'))
      ]);
      await waffle.provider.send("evm_increaseTime", [3600]);
      await waffle.provider.send("evm_mine");
    });

    it('claims all rewards successfully', async () => {
      await stakingRewardsHelper.connect(user1).claimAllRewards();

      // Note: there are 3 - 5 seconds delay caused by 'evm_mine' in the following calculation.
      const bal = await rewardsToken.balanceOf(user1Address);
      expect(bal).to.gt(toWei('0.1785')); // 3600 / (86400*7) * 10e18 + 3600 / (86400*7) * 20e18
      expect(bal).to.lt(toWei('0.1789'));

      expect(await stakingRewards1.earned(rewardsToken.address, user1Address)).to.eq(0);
      expect(await stakingRewards2.earned(rewardsToken.address, user1Address)).to.eq(0);
    });

    it('claims some rewards successfully', async () => {
      await stakingRewardsHelper.connect(user1).claimRewards([stakingRewards1.address]);

      // Note: there are 3 - 5 seconds delay caused by 'evm_mine' in the following calculation.
      const bal = await rewardsToken.balanceOf(user1Address);
      expect(bal).to.gt(toWei('0.0595')); // 3600 / (86400*7) * 10e18
      expect(bal).to.lt(toWei('0.0597'));

      expect(await stakingRewards1.earned(rewardsToken.address, user1Address)).to.eq(0);
      expect(await stakingRewards2.earned(rewardsToken.address, user1Address)).to.gt(0);
    });

    it('gets user claimable rewards', async () => {
      const userClaimable = await stakingRewardsHelper.getUserClaimableRewards(user1Address, [rewardsToken.address]);
      expect(userClaimable.length).to.eq(1);
      expect(userClaimable[0].rewardToken.rewardTokenAddress).to.eq(rewardsToken.address);
      expect(userClaimable[0].amount).to.gt(toWei('0.1785')); // 3600 / (86400*7) * 10e18 + 3600 / (86400*7) * 20e18
      expect(userClaimable[0].amount).to.lt(toWei('0.1789'));
    });

    it('gets user staked', async () => {
      const userStaked = await stakingRewardsHelper.getUserStaked(user1Address);
      expect(userStaked.length).to.eq(2);
      expect(userStaked[0].stakingTokenAddress).to.eq(stakingToken1.address);
      expect(userStaked[0].balance).to.eq(toWei('100'));
      expect(userStaked[1].stakingTokenAddress).to.eq(stakingToken2.address);
      expect(userStaked[1].balance).to.eq(toWei('100'));
    });
  });

  describe('seize', async () => {
    beforeEach(async () => {
      await stakingToken1.transfer(stakingRewardsHelper.address, toWei('100'));
    });

    it('seizes successfully', async () => {
      const balance1 = await stakingToken1.balanceOf(adminAddress);
      await stakingRewardsHelper.seize(stakingToken1.address, toWei('100'));
      const balance2 = await stakingToken1.balanceOf(adminAddress);
      expect(balance2.sub(balance1)).to.eq(toWei('100'));
    });

    it('fails to seize for non-admin', async () => {
      await expect(stakingRewardsHelper.connect(user1).seize(stakingToken1.address, toWei('100'))).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('getRewardTokenInfo', async () => {
    it('gets reward token info', async () => {
      const rewardTokenInfo = await stakingRewardsHelper.getRewardTokenInfo(rewardsToken.address);
      expect(rewardTokenInfo.rewardTokenAddress).to.eq(rewardsToken.address);
    });
  });

  describe('getStakingInfo', async () => {
    beforeEach(async () => {
      await Promise.all([
        stakingToken1.connect(user1).approve(stakingRewards1.address, toWei('50')),
        stakingToken2.connect(user1).approve(stakingRewards2.address, toWei('100'))
      ]);
      await Promise.all([
        stakingRewards1.connect(user1).stake(toWei('50')),
        stakingRewards2.connect(user1).stake(toWei('100'))
      ]);
    });

    it('gets staking info', async () => {
      const stakingInfo = await stakingRewardsHelper.getStakingInfo();
      expect(stakingInfo.length).to.eq(2);
      expect(stakingInfo[0].stakingTokenAddress).to.eq(stakingToken1.address);
      expect(stakingInfo[0].totalSupply).to.eq(toWei('50')); // 50
      expect(stakingInfo[0].rewardRates.length).to.eq(1);
      expect(stakingInfo[0].rewardRates[0].rewardTokenAddress).to.eq(rewardsToken.address);
      expect(stakingInfo[0].rewardRates[0].rate).to.eq(await stakingRewards1.rewardRate(rewardsToken.address));
      expect(stakingInfo[1].stakingTokenAddress).to.eq(stakingToken2.address);
      expect(stakingInfo[1].totalSupply).to.eq(toWei('100')); // 100
      expect(stakingInfo[1].rewardRates.length).to.eq(1);
      expect(stakingInfo[1].rewardRates[0].rewardTokenAddress).to.eq(rewardsToken.address);
      expect(stakingInfo[1].rewardRates[0].rate).to.eq(await stakingRewards2.rewardRate(rewardsToken.address));
    });
  });
});
